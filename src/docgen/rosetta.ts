import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { Language } from './languages.js';

/**
 * jsii-rosetta tablet reader: the per-language translations of a
 * package's README code examples ship inside the package itself, as a
 * gzipped `.jsii.tabl.json.gz` "tablet" next to the `.jsii` assembly.
 * The docgen reads that tablet rather than transliterating authored
 * TypeScript, since rosetta is the compiler-backed translator the CDK
 * publishes with.
 *
 * A tablet is a flat map of snippet hash -> snippet. Each snippet records
 * where it came from (`location.api`) and its translations keyed by
 * language, where `$` is the original (visible) TypeScript source. README
 * snippets are exactly those whose location api is `moduleReadme`, keyed
 * by the fully-qualified module they belong to, so a submodule README's
 * fences are addressable without scanning the whole tablet per page.
 *
 * The visible `$` source is byte-identical to the fence body in the
 * assembly's README markdown (`fullSource` is the fixtured, compilable
 * form and is NOT), which makes the fence body itself the lookup key —
 * no line-number bookkeeping that breaks when a README is reflowed.
 *
 * A type's own `docs.example` is a second kind of snippet, whose location
 * api is `type` and which carries its fqn. Those need no source key: one
 * snippet exists per documented type, so the fqn alone addresses it.
 */

/** Tablet translation key per documentation language. */
const TABLET_KEY: Record<Language, string> = {
  ts: '$',
  python: 'python',
  java: 'java',
  dotnet: 'csharp',
  go: 'go',
};

/** Translated sources for one example, by documentation language. */
export type ExampleTranslations = Partial<Record<Language, string>>;

/** README example translations for one assembly. */
export interface RosettaTablet {
  /**
   * Translations for a README fence body, or undefined when this fence
   * is not a rosetta-translated example (a `json`/`bash`/prose fence, or
   * a TypeScript fence rosetta never processed).
   */
  translationsFor(moduleFqn: string, source: string): ExampleTranslations | undefined;

  /**
   * Translations of a type's own `docs.example`, or undefined when the
   * tablet holds no snippet for it — a type without an example, or one
   * rosetta could not compile.
   */
  translationsForType(fqn: string): ExampleTranslations | undefined;

  /**
   * What rosetta compiled a README fence body with: the import statements
   * of its fixtured `fullSource`, i.e. the imports the example compiles
   * with. Undefined when the
   * fence is not a rosetta example. Optional, so a hand-built tablet need
   * not provide it.
   */
  compiledFor?(moduleFqn: string, source: string): CompiledExample | undefined;
}

/** A README example as rosetta compiled it. */
export interface CompiledExample {
  /**
   * The import statements of the fixtured, compilable source: the visible example's own imports plus the ones its
   * fixture supplies. Only the imports are kept, since the rest of a fixture is scaffolding nothing reads.
   */
  readonly imports?: string;
}

/** A tablet with no translations — every lookup misses. */
export const EMPTY_TABLET: RosettaTablet = {
  translationsFor: () => undefined,
  translationsForType: () => undefined,
};

/** Tablet file name shipped alongside a jsii assembly. */
const TABLET_FILE = '.jsii.tabl.json.gz';

/**
 * Per-process cache of parsed tablets, keyed by package directory.
 * Mirrors the assembly cache in `index.ts`: aws-cdk-lib's tablet is
 * ~130 MB of JSON once inflated, so the parse must not repeat across
 * generateDocs invocations in one process (Jest suites, watch mode).
 */
const tabletCache = new Map<string, RosettaTablet>();

/**
 * Load (and cache) the rosetta tablet shipped in a package directory.
 * A package without a tablet yields {@link EMPTY_TABLET} rather than
 * throwing: not every configured module ships one, and a missing tablet
 * must degrade to untranslated examples, never fail the build.
 */
export function loadTablet(assemblyDir: string): RosettaTablet {
  const key = path.resolve(assemblyDir);
  let tablet = tabletCache.get(key);
  if (tablet === undefined) {
    const file = path.join(key, TABLET_FILE);
    tablet = fs.existsSync(file)
      ? parseTablet(zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8'))
      : EMPTY_TABLET;
    tabletCache.set(key, tablet);
  }
  return tablet;
}

/**
 * Build a tablet from its raw JSON. `moduleReadme` snippets are indexed by
 * module fqn then by trimmed visible source; `type` snippets by fqn alone.
 * Everything else — `member` snippets, which no page renders — is dropped,
 * so the parsed 130 MB document is reduced to the examples the docgen can
 * actually use and the rest becomes collectable immediately.
 */
export function parseTablet(json: string): RosettaTablet {
  const raw = JSON.parse(json) as {
    readonly snippets?: Record<string, TabletSnippet>;
  };
  const byModule = new Map<string, Map<string, ExampleTranslations>>();
  const compiled = new Map<string, Map<string, CompiledExample>>();
  const byType = new Map<string, ExampleTranslations>();
  for (const snippet of Object.values(raw.snippets ?? {})) {
    const api = snippet.location?.api;
    if (api?.api === 'type' && api.fqn) {
      byType.set(api.fqn, collectTranslations(snippet));
      continue;
    }
    if (api?.api !== 'moduleReadme' || !api.moduleFqn) continue;
    const visible = snippet.translations?.[TABLET_KEY.ts]?.source;
    if (visible === undefined) continue;
    let examples = byModule.get(api.moduleFqn);
    if (examples === undefined) {
      examples = new Map();
      byModule.set(api.moduleFqn, examples);
    }
    examples.set(visible.trim(), collectTranslations(snippet));
    if (snippet.fullSource !== undefined) {
      let module = compiled.get(api.moduleFqn);
      if (module === undefined) {
        module = new Map();
        compiled.set(api.moduleFqn, module);
      }
      module.set(visible.trim(), { imports: importStatements(snippet.fullSource) });
    }
  }
  return {
    translationsFor: (moduleFqn, source) => byModule.get(moduleFqn)?.get(source.trim()),
    translationsForType: (fqn) => byType.get(fqn),
    compiledFor: (moduleFqn, source) => compiled.get(moduleFqn)?.get(source.trim()),
  };
}

/** Pick out the translations for documentation languages we render. */
function collectTranslations(snippet: TabletSnippet): ExampleTranslations {
  const translations: ExampleTranslations = {};
  for (const [lang, tabletKey] of Object.entries(TABLET_KEY) as [Language, string][]) {
    const source = snippet.translations?.[tabletKey]?.source;
    if (source !== undefined) {
      translations[lang] = source;
    }
  }
  return translations;
}

/** The top-level `import … ;` statements of a TypeScript source, joined by newlines. */
export function importStatements(source: string): string {
  return (source.match(/^import\b[^;]*;/gm) ?? []).join('\n');
}

/** The subset of the tablet snippet schema the docgen reads. */
interface TabletSnippet {
  readonly translations?: Record<string, { readonly source?: string }>;
  readonly fullSource?: string;
  readonly location?: {
    readonly api?: { readonly api?: string; readonly moduleFqn?: string; readonly fqn?: string };
  };
}
