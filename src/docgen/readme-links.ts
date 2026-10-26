import { pageHref } from './links.js';

/**
 * Type links for README code examples, resolved from each example's own imports so a name is never guessed.
 *
 * - `import { App, aws_s3 as s3 } from 'aws-cdk-lib'` makes the bare `App` resolve to `aws-cdk-lib.App`, and `s3`
 *   resolve to the `aws-cdk-lib.aws_s3` submodule.
 * - `import * as s3 from 'aws-cdk-lib/aws-s3'` makes `s3.Bucket` resolve to `aws-cdk-lib.aws_s3.Bucket`.
 * - A qualified chain resolves step by step, so `cdk.aws_s3.Bucket` and `s3.CfnBucket.LoggingConfigurationProperty`
 *   link their type names.
 * - A name that is not imported, or resolves to nothing with a page here, stays plain. So does a name the example
 *   declares itself (`class MyStack`, `const App = …`), and a name two imports would resolve differently.
 *
 * The result is the `type-links=Name:href,…` fence attribute that signature fences and type-page examples already
 * carry, so the one `applyTypeLinks` highlight hook draws the links.
 */

/** Maps a TypeScript import path to the jsii module or submodule fqn it names. */
export type ImportModules = ReadonlyMap<string, string>;

/** Minimal assembly shape: the name and the submodule fqns. */
interface AssemblyLike {
  readonly name: string;
  readonly submodules?: Readonly<Record<string, unknown>>;
}

/**
 * Import paths for the documented assemblies: the package name for its root, and `<package>/<sub-module>` for each
 * top-level submodule, spelled with dashes the way the package exports it (`aws_s3` -> `aws-cdk-lib/aws-s3`).
 */
export function importModules(assemblies: Iterable<AssemblyLike>): ImportModules {
  const modules = new Map<string, string>();
  for (const assembly of assemblies) {
    modules.set(assembly.name, assembly.name);
    for (const fqn of Object.keys(assembly.submodules ?? {})) {
      const rest = fqn.slice(assembly.name.length + 1);
      if (!fqn.startsWith(`${assembly.name}.`) || rest.includes('.')) {
        continue;
      }
      modules.set(`${assembly.name}/${rest.replace(/_/g, '-')}`, fqn);
    }
  }
  return modules;
}

const IDENT = '[A-Za-z_$][\\w$]*';

/**
 * Local names an example's import statements bind, each to the jsii fqn it stands for (a type, a submodule or a
 * module). A default import names no jsii export, so it binds nothing.
 */
export function importBindings(imports: string, modules: ImportModules): Map<string, string> {
  const bindings = new Map<string, string>();
  // `import s3 = require('aws-cdk-lib/aws-s3');`, the form rosetta's fixtures use.
  const requireImport = new RegExp(`\\bimport\\s+(${IDENT})\\s*=\\s*require\\(\\s*(['"])([^'"]+)\\2\\s*\\)`, 'g');
  for (const [, local, , path] of imports.matchAll(requireImport)) {
    const module = modules.get(path);
    if (module) {
      bindings.set(local, module);
    }
  }
  const statement = new RegExp('\\bimport\\s+(?:type\\s+)?([^;]*?)\\s+from\\s*([\'"])([^\'"]+)\\2', 'g');
  for (const [, clause, , path] of imports.matchAll(statement)) {
    const module = modules.get(path);
    if (!module) {
      continue;
    }
    const namespace = new RegExp(`^\\*\\s+as\\s+(${IDENT})$`).exec(clause.trim());
    if (namespace) {
      bindings.set(namespace[1], module);
      continue;
    }
    const named = /\{([^}]*)\}/.exec(clause);
    for (const item of named?.[1].split(',') ?? []) {
      const m = new RegExp(`^(?:type\\s+)?(${IDENT})(?:\\s+as\\s+(${IDENT}))?$`).exec(item.trim());
      if (m) {
        bindings.set(m[2] ?? m[1], `${module}.${m[1]}`);
      }
    }
  }
  return bindings;
}

/** Names the example declares itself, which therefore do not refer to an import. */
function localDeclarations(code: string): Set<string> {
  const declared = new Set<string>();
  const re = new RegExp(`\\b(?:class|interface|enum|type|function|const|let|var)\\s+(${IDENT})`, 'g');
  for (const [, name] of code.matchAll(re)) {
    declared.add(name);
  }
  return declared;
}

/** Options for {@link readmeTypeLinksAttr}. */
export interface ReadmeTypeLinkOptions {
  /** Import statements to resolve against: the visible example's, or rosetta's fixtured ones. */
  readonly imports: string;
  readonly modules: ImportModules;
  readonly linkFor: (fqn: string) => string | undefined;
}

/**
 * The `type-links=Name:href,…` attribute for one README example. `code` is the visible example with its string
 * literals and comments already blanked, so a name inside them is never offered.
 */
export function readmeTypeLinksAttr(code: string, options: ReadmeTypeLinkOptions): string {
  const bindings = importBindings(options.imports, options.modules);
  if (bindings.size === 0) {
    return '';
  }
  const declared = localDeclarations(code);
  const hrefs = new Map<string, string | undefined>();
  const offer = (name: string, fqn: string): void => {
    const link = options.linkFor(fqn);
    if (!link) {
      return;
    }
    const href = pageHref(link);
    // `:`/`,` are the attribute's separators, so such an href is unusable.
    if (/[\s,:]/.test(href)) {
      return;
    }
    // A name two imports resolve differently is dropped, never guessed.
    hrefs.set(name, hrefs.has(name) && hrefs.get(name) !== href ? undefined : href);
  };

  // Every identifier chain `a.b.c` not preceded by a `.`: its head must be an import binding, then each step is
  // tried in turn, so a type and a type nested in it both link.
  const chain = new RegExp(`(?<![\\w$.])(${IDENT})((?:\\s*\\.\\s*${IDENT})*)`, 'g');
  for (const [, head, tail] of code.matchAll(chain)) {
    const base = bindings.get(head);
    if (base === undefined || declared.has(head)) {
      continue;
    }
    offer(head, base);
    let fqn = base;
    for (const step of tail.split('.').map((s) => s.trim()).filter(Boolean)) {
      fqn = `${fqn}.${step}`;
      if (!declared.has(step)) {
        offer(step, fqn);
      }
    }
  }

  const pairs = [...hrefs].filter((pair): pair is [string, string] => pair[1] !== undefined)
    .map(([name, href]) => `${name}:${href}`);
  return pairs.length > 0 ? `type-links=${pairs.join(',')}` : '';
}
