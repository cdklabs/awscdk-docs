import * as spec from '@jsii/spec';
import { anchoredHeading, SECTION_ANCHORS } from './anchors.js';
import { codeFence } from './fences.js';
import {
  camelToSnake,
  dotnetCoordinates,
  FENCE_LANG,
  goCoordinates,
  Language,
  translateImport,
  translateModuleName,
} from './languages.js';
import { pageHref } from './links.js';
import { RosettaTablet } from './rosetta.js';
import { languageVariantBlocks, orderedLanguages } from './variants.js';

/**
 * Per-language code examples: the `## Example` section on a type page becomes a `<LanguageTabs>` group with one
 * fenced code block per enabled language, synced to the shared client-side language state like every other variant
 * region.
 *
 * Content per tab:
 * - TypeScript: the authored `docs.example` when present (jsii examples are authored in TypeScript), otherwise a
 *   generated minimal instantiation snippet.
 * - Other languages: the authored example's translation from the package's jsii-rosetta tablet, which ships the
 *   compiler-backed translation of every documented type's example. A type the tablet has no entry for falls back
 *   to a generated minimal instantiation snippet (import + `new`-equivalent call).
 *
 * Fenced blocks get Shiki highlighting and VitePress's copy button for free, so the per-language fence id below is
 * all the renderer needs.
 *
 * Model B invariant: with a single enabled language the output is the plain single-language rendering (authored
 * example as a bare `ts` fence, or no section at all).
 */

/**
 * Fence ids live in languages.ts (shared with the generated-signature emitters); re-exported here for importers.
 */
export { FENCE_LANG } from './languages.js';

export interface ExampleOptions {
  /**
   * Render the construct instantiation form (`new Queue(this, 'MyQueue')`)
   * instead of parameter-name placeholders. Callers that classified the
   * type (renderConstructPage) set this.
   */
  readonly construct?: boolean;

  /**
   * Canonical page resolver: when supplied, type names in the example that resolve to a documented page are emitted
   * as a `type-links=Name:href,…` fence attribute, and the shared `markdown.highlight` hook turns them into links
   * inside the highlighted output. Omitted by callers that have no resolver.
   *
   * Same shape as `SignatureOptions.linkFor`, and the same function instance the rest of the page uses, so examples
   * cannot drift from the signatures and props tables above them.
   */
  readonly linkFor?: (fqn: string) => string | undefined;

  /**
   * The package's rosetta tablet, supplying each non-TypeScript tab with the translation of the authored example.
   * Omitted by callers that render a page in isolation, which keeps the generated-snippet behavior.
   */
  readonly tablet?: RosettaTablet;
}

/** True when a minimal instantiation snippet can be generated for a type. */
export function canGenerateExample(type: spec.Type): type is spec.ClassType {
  return spec.isClassType(type)
    && type.initializer !== undefined
    && !type.initializer.protected
    && !type.abstract;
}

/** `queue` / `cfn_bucket`-style local variable name for an instance. */
function variableName(typeName: string, lang: Language): string {
  if (lang === 'python') {
    return camelToSnake(typeName);
  }
  return typeName.charAt(0).toLowerCase() + typeName.slice(1);
}

/** Placeholder argument for a required parameter: its (translated) name. */
function paramPlaceholder(param: spec.Parameter, lang: Language): string {
  return lang === 'python' ? camelToSnake(param.name) : param.name;
}

/**
 * Argument list for the minimal instantiation call. Constructs get the
 * idiomatic `scope, id` pair; other classes reference their required
 * parameters by name as "assume these exist" placeholders. Optional
 * parameters are omitted — except in Go, where jsii-generated `New*`
 * functions take every parameter positionally, so optionals become `nil`.
 */
function callArgs(type: spec.ClassType, lang: Language, construct: boolean): string[] {
  const params = type.initializer?.parameters ?? [];
  if (construct && params.length >= 2) {
    const id = `My${type.name}`;
    const scope = lang === 'python' ? 'self' : 'this';
    const idArg = lang === 'ts' ? `'${id}'`
      : lang === 'go' ? `jsii.String("${id}")`
        : `"${id}"`;
    const args = [scope, idArg];
    if (lang === 'go') {
      args.push(...params.slice(2).map(() => 'nil'));
    }
    return args;
  }
  const args = params
    .filter((p) => !p.optional && !p.variadic)
    .map((p) => paramPlaceholder(p, lang));
  if (lang === 'go') {
    args.push(...params.filter((p) => p.optional && !p.variadic).map(() => 'nil'));
  }
  return args;
}

/** Go package alias qualifying the `New*` call, e.g. `awssqs`. */
function goPackageAlias(type: spec.ClassType, assembly: spec.Assembly): string {
  // Drop a trailing semantic-import-versioning segment (`/v2`) — the Go
  // package identifier is the segment before it (`awscdk`), not `v2`.
  const path = translateModuleName(type.fqn, assembly, 'go').replace(/\/v\d+$/, '');
  const alias = path.split('/').pop() ?? assembly.name;
  return alias.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * True when jsii-pacmak emits a Java `Builder` for the class: its last
 * initializer parameter is a struct (datatype interface) that jsii lifts
 * into builder setters. Resolution goes through `assembly.types` — a
 * struct from another assembly is not resolvable here, so those classes
 * conservatively keep the constructor form.
 */
export function hasJavaBuilder(type: spec.ClassType, assembly: spec.Assembly): boolean {
  const params = type.initializer?.parameters ?? [];
  const last = params[params.length - 1];
  if (!last?.type || !spec.isNamedTypeReference(last.type)) {
    return false;
  }
  const entry = assembly.types?.[last.type.fqn];
  return entry !== undefined && spec.isInterfaceType(entry) && entry.datatype === true;
}

/**
 * The Java builder-form instantiation, e.g.
 * `Queue queue = Queue.Builder.create(this, "MyQueue").build();`.
 * `create()` takes the initializer parameters preceding the lifted
 * struct — the idiomatic `scope, id` pair for constructs, required
 * parameters by placeholder name otherwise.
 */
function javaBuilderInstantiation(type: spec.ClassType, construct: boolean): string {
  const name = type.name;
  const varName = variableName(name, 'java');
  const params = type.initializer?.parameters ?? [];
  const createArgs = construct && params.length >= 2
    ? ['this', `"My${name}"`]
    : params.slice(0, -1).filter((p) => !p.optional && !p.variadic).map((p) => p.name);
  return `${name} ${varName} = ${name}.Builder.create(${createArgs.join(', ')}).build();`;
}

/**
 * The install command line(s) leading a snippet, for the languages whose package is not implied by the import: the
 * C# tab carries its NuGet package id and the Go tab its module path. Empty when the assembly declares no
 * coordinates for that target, and for languages installed as one package per assembly.
 */
function installLines(type: spec.ClassType, assembly: spec.Assembly, lang: Language): string[] {
  if (lang === 'go') {
    const coords = goCoordinates(assembly, type.fqn);
    return coords ? [`// Install: go get ${coords.moduleName}`] : [];
  }
  if (lang === 'dotnet') {
    const coords = dotnetCoordinates(assembly, type.fqn);
    return coords ? [`// Install: dotnet add package ${coords.packageId}`] : [];
  }
  return [];
}

/** Import line(s) for the snippet. */
function importLines(
  type: spec.ClassType,
  assembly: spec.Assembly,
  lang: Language,
  construct: boolean,
): string[] {
  const install = installLines(type, assembly, lang);
  if (lang === 'go') {
    // The go module path comes from the assembly's `targets.go` metadata: lead the snippet with the `go get`
    // command so the Go tab carries the install unit alongside the import, like the C# tab's NuGet line.
    if (construct) {
      // The construct form uses jsii.String for the id, so import the
      // jsii runtime alongside the module in one grouped import.
      return [
        ...install,
        'import (',
        '\t"github.com/aws/jsii-runtime-go"',
        `\t"${translateModuleName(type.fqn, assembly, 'go')}"`,
        ')',
      ];
    }
    return [...install, translateImport(type.fqn, assembly, lang)];
  }
  if (lang === 'dotnet') {
    // NuGet coordinates come from the assembly's `targets.dotnet` metadata: lead the snippet with the install
    // command so the C# tab carries the package id alongside the `using` directive.
    const coords = dotnetCoordinates(assembly, type.fqn);
    if (coords) {
      return [...install, `using ${coords.namespace};`];
    }
  }
  return [translateImport(type.fqn, assembly, lang)];
}

/** The instantiation statement, per language. */
function instantiation(
  type: spec.ClassType,
  assembly: spec.Assembly,
  lang: Language,
  construct: boolean,
): string {
  const name = type.name;
  const varName = variableName(name, lang);
  const args = callArgs(type, lang, construct).join(', ');
  switch (lang) {
    case 'ts':
      return `const ${varName} = new ${name}(${args});`;
    case 'python':
      return `${varName} = ${name}(${args})`;
    case 'java':
      // jsii emits a Builder when the last initializer parameter is a struct — the idiomatic Java instantiation.
      // Classes without a lifted struct keep the plain constructor form.
      return hasJavaBuilder(type, assembly)
        ? javaBuilderInstantiation(type, construct)
        : `${name} ${varName} = new ${name}(${args});`;
    case 'dotnet':
      return `var ${varName} = new ${name}(${args});`;
    case 'go':
      return `${varName} := ${goPackageAlias(type, assembly)}.New${name}(${args})`;
  }
}

/**
 * A generated minimal instantiation snippet for one language:
 * import statement, blank line, instantiation.
 */
export function generatedExample(
  type: spec.ClassType,
  assembly: spec.Assembly,
  lang: Language,
  options: ExampleOptions = {},
): string {
  const construct = options.construct ?? false;
  return [
    ...importLines(type, assembly, lang, construct),
    '',
    instantiation(type, assembly, lang, construct),
  ].join('\n');
}

/** Authored example as a plain TypeScript fenced block. */
function authoredFence(example: string, attr: string): string[] {
  return [anchoredHeading(2, 'Example', SECTION_ANCHORS.example), '', ...codeFence(example, `ts${attr ? ` ${attr}` : ''}`), ''];
}

/**
 * Display name → FQN for one assembly's own types, memoized per assembly. An ambiguous name maps to `undefined`
 * and is never linked.
 */
const displayNameIndexes = new WeakMap<spec.Assembly, Map<string, string | undefined>>();

function displayNameIndex(assembly: spec.Assembly): Map<string, string | undefined> {
  const cached = displayNameIndexes.get(assembly);
  if (cached) {
    return cached;
  }
  const index = new Map<string, string | undefined>();
  for (const fqn of Object.keys(assembly.types ?? {})) {
    const name = fqn.split('.').pop()!;
    if (index.has(name) && index.get(name) !== fqn) {
      index.set(name, undefined); // ambiguous display name — never linked
    } else {
      index.set(name, fqn);
    }
  }
  displayNameIndexes.set(assembly, index);
  return index;
}

/** Identifier tokens, matched the way the highlight hook matches them. */
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;

/**
 * Blank string literals and comments (same-length padding), keeping `${…}` template holes, which are source rather
 * than text. One ordered pass, not independent replacements, because the constructs nest.
 */
export function withoutLiteralsAndComments(code: string): string {
  const out = code.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') {
        out[i] = ' ';
      }
    }
  };
  const lineEnd = (from: number): number => {
    const nl = code.indexOf('\n', from);
    return nl === -1 ? code.length : nl;
  };

  let i = 0;
  while (i < code.length) {
    const c = code[i];

    if (c === '/' && code[i + 1] === '/') {
      const stop = lineEnd(i);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '#') {
      const stop = lineEnd(i);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2);
      const stop = close === -1 ? code.length : close + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') {
        j += code[j] === '\\' ? 2 : 1;
      }
      const stop = Math.min(j + 1, code.length);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '`') {
      // Blank the literal segments of the template, leaving each `${…}`
      // hole untouched so the identifiers inside it are still scanned.
      let segment = i;
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === '`') {
          j++;
          break;
        }
        if (code[j] === '$' && code[j + 1] === '{') {
          blank(segment, j);
          let depth = 1;
          let k = j + 2;
          while (k < code.length && depth > 0) {
            if (code[k] === '{') {
              depth++;
            } else if (code[k] === '}') {
              depth--;
            }
            k++;
          }
          j = k;
          segment = k;
          continue;
        }
        j++;
      }
      blank(segment, Math.min(j, code.length));
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * The `type-links=Name:href,…` fence attribute for example code — the same attribute generated signature fences
 * carry, resolved by the one `applyTypeLinks` hook. Emits only identifiers in live code that are unambiguous types
 * of this assembly with a page; matching is case-sensitive, so the local `bucket` stays plain and `Bucket` links.
 */
export function exampleTypeLinksAttr(
  code: string,
  assembly: spec.Assembly,
  linkFor?: (fqn: string) => string | undefined,
): string {
  if (!linkFor) {
    return '';
  }
  const index = displayNameIndex(assembly);
  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const name of withoutLiteralsAndComments(code).match(IDENTIFIER_RE) ?? []) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const fqn = index.get(name);
    if (!fqn) {
      continue; // not a type in this assembly, or an ambiguous display name
    }
    const link = linkFor(fqn);
    if (!link) {
      continue; // no documented page for it
    }
    const href = pageHref(link);
    // `:`/`,` are the attribute's separators, so such an href is unusable.
    if (/[\s,:]/.test(href)) {
      continue;
    }
    pairs.push(`${name}:${href}`);
  }
  return pairs.length > 0 ? `type-links=${pairs.join(',')}` : '';
}

/**
 * The `## Example` section for a type page.
 *
 * - Single enabled language: the authored example or nothing.
 * - Multiple languages, instantiable class: a `<LanguageTabs>` group with one fenced block per language (authored
 *   example on the TypeScript tab when present, its tablet translation elsewhere, generated snippets where the
 *   tablet has no entry).
 * - Multiple languages, non-instantiable type (enum, struct, interface, abstract class): the authored example stays
 *   a bare TypeScript fence — there is nothing meaningful to generate for other languages.
 */
export function exampleSection(
  type: spec.Type,
  assembly: spec.Assembly,
  languages: readonly Language[],
  options: ExampleOptions = {},
): string[] {
  const langs = orderedLanguages(languages);
  const authored = type.docs?.example;
  if (langs.length <= 1 || !canGenerateExample(type)) {
    return authored
      ? authoredFence(authored, exampleTypeLinksAttr(authored, assembly, options.linkFor))
      : [];
  }
  const translated = options.tablet?.translationsForType(type.fqn);
  return [
    anchoredHeading(2, 'Example', SECTION_ANCHORS.example),
    '',
    // hydrated: each variant is a fenced code block that VitePress compiles
    // into a Shiki `language-<lang>` div with the runtime-wired copy-code
    // button — `v-pre` would ship that button dead on every non-canonical
    // tab (see VariantBlockOptions.hydrated).
    ...languageVariantBlocks(langs, (lang) => {
      const translation = lang === 'ts' ? undefined : translated?.[lang];
      const code = lang === 'ts' && authored
        ? authored
        : translation !== undefined
          ? [...installLines(type, assembly, lang), translation].join('\n')
          : generatedExample(type, assembly, lang, options);
      // Per-variant attribute: each language's snippet mentions its own
      // set of type names, and the hook is applied per fence.
      const attr = exampleTypeLinksAttr(code, assembly, options.linkFor);
      return codeFence(code, `${FENCE_LANG[lang]}${attr ? ` ${attr}` : ''}`);
    }, { hydrated: true }),
  ];
}
