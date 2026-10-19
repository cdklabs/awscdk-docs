import * as fs from 'fs';
import * as path from 'path';
import * as spec from '@jsii/spec';
import { toAgentMarkdown, withFrontmatterKey } from './agent-markdown.js';
import { anchoredHeading, pinTitleAnchor, SECTION_ANCHORS, titleAnchor } from './anchors.js';
import { hashedAssetName } from './asset-hash.js';
import { buildFacadeIndex, buildTraitIndex } from './classification.js';
import {
  buildTypeIndex,
  constructLevel,
  ConstructLevel,
  constructLevelLabel,
  escapeCell,
  escapeProse,
  isConstruct,
  renderConstructPage,
  TypeIndex,
} from './constructs.js';
import { removeAll } from './escape.js';
import { FENCE_LANG } from './examples.js';
import { codeFence, mapProse, tokenizeFences } from './fences.js';
import { injectBadges } from './freshness.js';
import { BreadcrumbSegment, renderBreadcrumb } from './header.js';
import {
  addedInBadge,
  emptyLedger,
  isAddedIn,
  Ledger,
  loadLedger,
  PageHistory,
  readLedger,
  readmeHistory,
  typeHistory,
  updateLedger,
  writeLedger,
} from './history.js';
import { LANGUAGES, Language, LanguageMeta, sidebarModuleLabels } from './languages.js';
import { API_ROOT, moduleReadmeLink, typePageLink } from './links.js';
import { LlmsTxtEntry, renderLlmsTxt, titleOf } from './llms-txt.js';
import { HISTORY_FRONTMATTER } from '../page-history.js';
import { SITE_TITLE, STABILITY_ROUTE } from '../site-routes.js';
import { buildMixinClassification, MixinIndex, renderMixinPage } from './mixins.js';
import { byLevelThenName } from './ordering.js';
import {
  assertOverviewsResolvable,
  overviewFor,
  type OverviewMap,
  type OverviewSpec,
  parseOverviews,
} from './overviews.js';
import { upstreamReadmeUrl } from './provenance.js';
import { ExampleTranslations, loadTablet, RosettaTablet } from './rosetta.js';
import { searchFilterHtml, searchKind, searchModule } from './search.js';
import { buildServiceSidebar, renameChunks, SidebarEntry, SidebarItem, splitSidebarChunks } from './sidebar.js';
import { buildSubclassIndex } from './subclasses.js';
import {
  buildSymbolIndex,
  buildUsageIndex,
  renderClassPage,
  renderEnumPage,
  renderInterfacePage,
  renderStructPage,
  UsageIndex,
} from './symbols.js';
import { languageVariantBlocks } from './variants.js';
import { docsSiteUrl } from './versions.js';

/**
 * Docgen configuration. The list of modules to document lives in
 * `docgen.config.json` at the repository root, so adding a module
 * is a one-line config change.
 */
export interface DocgenConfig {
  /** npm package names of jsii modules to document. */
  readonly modules: string[];
  /** Per-module classifications to emit; absent modules emit every classified type. */
  readonly includeKinds?: Readonly<Record<string, readonly string[]>>;
  /** Whether each module emits type-level examples; absent modules emit examples. */
  readonly emitExamples?: Readonly<Record<string, boolean>>;
  /** Languages to generate docs for (defaults to all LANGUAGES). */
  readonly languages?: Language[];
  /**
   * Per-module overview behavior, keyed by module id — `<assemblyName>` for a package root,
   * `<assemblyName>.<submodule>` for a submodule. Absent or unlisted means `{ kind: 'readme' }`. See `./overviews.ts`
   * for the kinds and the validation rules.
   */
  readonly overviews?: OverviewMap;
}

export interface GenerateOptions {
  /** Directory where markdown pages are written. */
  readonly outDir: string;
  /** Directory containing node_modules (defaults to cwd). */
  readonly packageRoot?: string;
  /**
   * Version-history ledger (`docgen.baseline.json`), read only: it dates every type and README page and decides the
   * `Added in` badge. No file, no history on any page. The build never writes it — see `updateHistoryLedger`.
   */
  readonly ledgerFile?: string;
  /** Languages to generate (overrides config). Defaults to all LANGUAGES. */
  readonly languages?: Language[];
  /**
   * VitePress public directory. When set, a `type-summaries.json` lookup and a content-hashed symbol index are
   * written there for client-side hover tooltips and the navbar type-ahead filter.
   */
  readonly publicDir?: string;
  /** File path for the generated API-root page. */
  readonly overviewFile?: string;
  /**
   * Authored Markdown used for the API-root page. When absent, the primary module README remains the source.
   */
  readonly overviewSourceFile?: string;
  /**
   * Directory for the agent-oriented Markdown twin of every generated page, laid out as a site tree
   * (`<agentOutDir>/v2/docs/<page>.md`) so the merge step can overlay it onto the built site verbatim. Each canonical
   * page then carries an `agentMarkdown` frontmatter key naming its twin, which is what the theme renders the
   * download link and `<link rel="alternate">` from. Unset: no twins, no key.
   */
  readonly agentOutDir?: string;
}

export interface TypeEntry {
  readonly name: string;
  readonly kind: string;
  readonly summary: string;
  /** Site-absolute link to the type's dedicated page. */
  readonly link: string;
  /** The underlying jsii type, for page generation. */
  readonly type: spec.Type;
  /**
   * Construct level, from {@link constructLevel} — the same determination that badges the page H1. Carried here so
   * the sidebar generator reuses this classification instead of re-deriving it (or parsing it back out of
   * {@link kind}); absent for everything that is not a leveled construct.
   */
  readonly level?: ConstructLevel;
}

export function loadConfig(file: string): DocgenConfig {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(raw.modules) || raw.modules.some((m: unknown) => typeof m !== 'string')) {
    throw new Error(`${file}: "modules" must be an array of package names`);
  }
  const includeKinds = raw.includeKinds;
  if (includeKinds !== undefined) {
    if (
      typeof includeKinds !== 'object'
      || includeKinds === null
      || Array.isArray(includeKinds)
      || Object.entries(includeKinds).some(
        ([moduleName, kinds]) =>
          !raw.modules.includes(moduleName)
          || !Array.isArray(kinds)
          || kinds.length === 0
          || kinds.some((kind: unknown) => typeof kind !== 'string'),
      )
    ) {
      throw new Error(`${file}: "includeKinds" must map configured modules to non-empty arrays of classifications`);
    }
  }
  const emitExamples = raw.emitExamples;
  if (
    emitExamples !== undefined
    && (
      typeof emitExamples !== 'object'
      || emitExamples === null
      || Array.isArray(emitExamples)
      || Object.entries(emitExamples).some(
        ([moduleName, enabled]) => !raw.modules.includes(moduleName) || typeof enabled !== 'boolean',
      )
    )
  ) {
    throw new Error(`${file}: "emitExamples" must map configured modules to booleans`);
  }
  // Shape-validated here so a malformed `overviews` block fails at config load; the key/`from` resolution needs the
  // assemblies and happens in generateDocs, still before any page is written.
  const overviews = parseOverviews(raw.overviews, file);
  const config: DocgenConfig = {
    modules: raw.modules,
    ...(includeKinds ? { includeKinds } : {}),
    ...(emitExamples ? { emitExamples } : {}),
    ...(overviews.size > 0 ? { overviews } : {}),
  };
  if (raw.languages !== undefined) {
    if (!Array.isArray(raw.languages) || raw.languages.some((l: unknown) => typeof l !== 'string')) {
      throw new Error(`${file}: "languages" must be an array of language identifiers`);
    }
    const validIds = LANGUAGES.map((l) => l.id);
    for (const l of raw.languages) {
      if (!validIds.includes(l)) {
        throw new Error(`${file}: unknown language "${l}". Valid: ${validIds.join(', ')}`);
      }
    }
    return { ...config, languages: raw.languages };
  }
  return config;
}

/**
 * Resolve which languages to generate, respecting options > config > default (all).
 */
function resolveLanguages(config: DocgenConfig, options: GenerateOptions): LanguageMeta[] {
  const ids = options.languages ?? config.languages ?? LANGUAGES.map((l) => l.id);
  return LANGUAGES.filter((l) => ids.includes(l.id));
}

/**
 * Per-process cache of parsed assemblies, keyed by assembly directory.
 * Parsing the compressed aws-cdk-lib assembly costs ~1s per call; docgen
 * never mutates the parsed spec, so repeated generateDocs invocations in
 * one process (Jest suites, watch mode) can safely share the parse.
 */
const assemblyCache = new Map<string, spec.Assembly>();

/** Load (and cache) a single jsii assembly from a directory. */
export function loadAssembly(assemblyDir: string): spec.Assembly {
  const key = path.resolve(assemblyDir);
  let assembly = assemblyCache.get(key);
  if (assembly === undefined) {
    assembly = spec.loadAssemblyFromPath(key, false, [...spec.ALL_SPEC_FEATURES]);
    assemblyCache.set(key, assembly);
  }
  return assembly;
}

/** Load every configured assembly from node_modules. */
function loadAssemblies(config: DocgenConfig, packageRoot: string): Map<string, spec.Assembly> {
  const assemblies = new Map<string, spec.Assembly>();
  for (const moduleName of config.modules) {
    const assemblyDir = path.join(packageRoot, 'node_modules', moduleName);
    if (!fs.existsSync(assemblyDir)) {
      throw new Error(
        `Module "${moduleName}" not found in node_modules. Is it listed as a devDependency in .projenrc.ts?`,
      );
    }
    assemblies.set(moduleName, loadAssembly(assemblyDir));
  }
  return assemblies;
}

/**
 * Bring the version-history ledger up to the installed assemblies. The nightly version refresh runs this after the
 * new release is installed, so the ledger diff lands in the bump PR; the docs build only reads the result. Changes
 * are dated by the release's npm publish time when the committed version snapshot has it, else by this run.
 */
export function updateHistoryLedger(
  config: DocgenConfig,
  ledgerFile: string,
  packageRoot?: string,
  releasedAt: (name: string, version: string) => string | undefined = () => undefined,
): { introduced: number; changed: number; seeded: number } {
  const root = packageRoot ?? process.cwd();
  const assemblies = loadAssemblies(config, root);
  const loaded = readLedger(ledgerFile) ?? { ledger: emptyLedger(), migrated: false };
  const typeIndex = buildTypeIndex([...assemblies.values()]);
  const { mixins, mixinClasses } = buildMixinClassification(typeIndex);
  const facades = buildFacadeIndex(typeIndex);
  const traits = buildTraitIndex(typeIndex);
  const documentedAssemblies = config.modules.map((moduleName) => {
    const assembly = assemblies.get(moduleName)!;
    const includeKinds = config.includeKinds?.[moduleName];
    if (!includeKinds) {
      return assembly;
    }
    const groups = groupTypes(assembly, typeIndex, mixins, mixinClasses, facades, traits, includeKinds);
    const types = Object.fromEntries(
      [...groups.values()].flatMap((entries) => entries.map((entry) => [entry.type.fqn, entry.type])),
    );
    return { ...assembly, types };
  });
  const summary = updateLedger(loaded.ledger, documentedAssemblies, {
    releasedAt: (a) => releasedAt(a.name, a.version),
    migrating: loaded.migrated,
  });
  const ledger = loaded.ledger;
  writeLedger(ledgerFile, ledger);
  return { introduced: summary.introduced.length, changed: summary.changed.length, seeded: summary.seeded.length };
}

/**
 * Generate one markdown page per module (and per submodule for modules with namespaces, like aws-cdk-lib), a
 * dedicated page per construct, plus a sidebar.json consumed by the VitePress config.
 *
 * Pages are generated once, in the single canonical tree — the flat shape `outDir/docs/<docId>….md` under
 * `/v2/`. The enabled languages only control which per-language variant regions each page embeds; they never
 * change the page tree or its URLs.
 */
export function generateDocs(config: DocgenConfig, options: GenerateOptions): string[] {
  const packageRoot = options.packageRoot ?? process.cwd();
  const written: string[] = [];
  // Every page embeds the variant regions for ALL enabled languages; the language set never affects the page tree,
  // which is generated once under the canonical prefix.
  const languageIds: Language[] = resolveLanguages(config, options).map((l) => l.id);

  // Load every assembly up front: construct detection and props
  // inlining need to resolve types across assembly boundaries
  // (e.g. aws-cdk-lib constructs extend constructs.Construct).
  const assemblies = loadAssemblies(config, packageRoot);
  // README example translations: each package ships its own jsii-rosetta tablet next to its assembly, so the lookup
  // is per module.
  const tabletFor = (moduleName: string): RosettaTablet =>
    loadTablet(path.join(packageRoot, 'node_modules', moduleName));
  const typeIndex = buildTypeIndex([...assemblies.values()]);
  // Both mixin shapes, sharing one marker resolution and one closure memo: interface-marked mixins, and the concrete
  // CLASSES extending the marker-carrying abstract base, which the interface-keyed index cannot hold.
  const {
    mixins: mixinIndex,
    mixinClasses: mixinClassIndex,
    implementors: implementorsIndex,
  } = buildMixinClassification(typeIndex);
  const facadeIndex = buildFacadeIndex(typeIndex);
  const traitIndex = buildTraitIndex(typeIndex);
  const usageIndex = buildUsageIndex(typeIndex);
  const subclassIndex = buildSubclassIndex(typeIndex);

  // Per-module overview behavior. Every documented module id — `<assembly>` for a package root,
  // `<assembly>.<submodule>` for a submodule — is collected here with the README it owns, so a `copy` entry can pull
  // another module's README and an unresolvable key fails before any page is written rather than at render time.
  const overviews: OverviewMap = config.overviews ?? new Map();
  interface OverviewSource {
    /** README markdown this module owns, if any. */
    readonly markdown?: string;
    /** Module fqn — the rosetta tablet's lookup key for its examples. */
    readonly fqn: string;
    /** npm package the module ships in, for the tablet load. */
    readonly packageName: string;
    /**
     * Upstream `README.md` this markdown came from, so the page's footer can link the file a reader can edit.
     * Undefined when the module has no README, or its assembly declares no repository — then no edit link is
     * rendered.
     */
    readonly upstream?: string;
  }
  const overviewSources = new Map<string, OverviewSource>();
  const packageRootIds: string[] = [];
  for (const moduleName of config.modules) {
    const assembly = assemblies.get(moduleName)!;
    packageRootIds.push(assembly.name);
    const rootUpstream = upstreamReadmeUrl(assembly, assembly.name);
    overviewSources.set(assembly.name, {
      ...(assembly.readme?.markdown ? { markdown: assembly.readme.markdown } : {}),
      fqn: assembly.name,
      packageName: moduleName,
      ...(rootUpstream ? { upstream: rootUpstream } : {}),
    });
    for (const [fqn, sub] of Object.entries(assembly.submodules ?? {})) {
      const upstream = upstreamReadmeUrl(assembly, fqn);
      overviewSources.set(fqn, {
        ...(sub.readme?.markdown ? { markdown: sub.readme.markdown } : {}),
        fqn,
        packageName: moduleName,
        ...(upstream ? { upstream } : {}),
      });
    }
  }
  assertOverviewsResolvable(overviews, overviewSources.keys(), packageRootIds);

  /**
   * Resolve one module's overview into the README to render (already
   * following a `copy`) plus the example-translation options that README
   * needs — a copied README's translations live in the SOURCE module's
   * tablet, under the source module's fqn.
   */
  const resolveOverview = (
    id: string,
  ): { generated: true } | { generated: false; readme?: string; upstream?: string; examples: ReadmeExampleOptions } => {
    const resolved = overviewFor(overviews, id);
    if (resolved.kind === 'generated') {
      return { generated: true };
    }
    const source =
      resolved.kind === 'copy' ? overviewSources.get(resolved.from)! : overviewSources.get(id)!;
    const readme = overviewReadme(resolved, source.markdown);
    // A `copy` page shows the SOURCE module's README, so that is the file
    // to edit — the same one-hop resolution the tablet lookup uses. A
    // `kind: 'none'` page renders no README, so it gets no edit link.
    return {
      generated: false,
      ...(readme ? { readme } : {}),
      ...(readme && source.upstream ? { upstream: source.upstream } : {}),
      examples: {
        moduleFqn: source.fqn,
        languages: languageIds,
        tablet: tabletFor(source.packageName),
      },
    };
  };

  // Version history of every page, read only. Absent ledger: no dates and no `Added in` badge anywhere.
  const ledger: Ledger | undefined = options.ledgerFile ? loadLedger(options.ledgerFile) : undefined;

  // Clean output directory to remove stale pages from removed modules
  fs.rmSync(options.outDir, { recursive: true, force: true });
  fs.mkdirSync(options.outDir, { recursive: true });
  if (options.agentOutDir) {
    fs.rmSync(options.agentOutDir, { recursive: true, force: true });
    fs.mkdirSync(options.agentOutDir, { recursive: true });
  }

  // Single canonical page tree: a flat `docs/` directory of `<docId>[.<submodule>][.<Type>].md` pages under
  // `/v2/`, so every deep link against the old reference resolves to a real page; `?lang=` selects the display
  // language client-side without changing the path.
  const docsDir = path.join(options.outDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  /** Absolute markdown file path for a site-root-relative page link. */
  const fileFor = (link: string): string =>
    path.join(options.outDir, `${link.slice(API_ROOT.length)}.md`);

  /**
   * Write one generated page. With an agent output directory, the page's agent-oriented twin is written at the same
   * site path with a `.md` extension, and the canonical page records that path in frontmatter so the theme only ever
   * advertises a twin that exists.
   */
  const emitPage = (link: string, content: string, history: PageHistory = {}): void =>
    emitPageFile(fileFor(link), `${link}.md`, withHistory(content, history));

  /**
   * A module overview is an ordinary page that the site-scoped `llms.txt` also lists, so its twin and title are
   * recorded here — one entry per emitted overview, whatever the module's overview kind resolved to.
   */
  const llmsEntries: LlmsTxtEntry[] = [];
  const emitOverview = (module: string, link: string, content: string, history: PageHistory = {}): void => {
    emitPage(link, content, history);
    if (options.agentOutDir) {
      const twin = `${link}.md`.replace(/^\/+/, '');
      llmsEntries.push({ module, twin, title: titleOf(toAgentMarkdown(content).markdown, module) });
    }
  };

  /**
   * The page's version history, applied the same way to every page kind: an `Added in` badge on the H1 when the
   * page was introduced in the documented minor line, and the recorded values as frontmatter for the head metas and
   * the footer. Unknown values are simply not written.
   */
  const withHistory = (content: string, history: PageHistory): string => {
    const version = assemblies.get(config.modules[0])!.version;
    const badged = isAddedIn(history, version) ? injectBadges(content, [addedInBadge(history.introducedIn!)]) : content;
    return withHistoryFrontmatter(badged, history);
  };

  /** The same, for a page whose file is given rather than derived from its route. */
  const emitPageFile = (file: string, twinHref: string, content: string): void => {
    if (options.agentOutDir) {
      const twin = path.join(options.agentOutDir, twinHref);
      fs.mkdirSync(path.dirname(twin), { recursive: true });
      fs.writeFileSync(twin, toAgentMarkdown(content).markdown);
      written.push(twin);
      content = withFrontmatterKey(content, 'agentMarkdown', twinHref);
    }
    fs.writeFileSync(file, content);
    written.push(file);
  };

  const sidebarEntries: SidebarEntry[] = [];

  if (options.overviewFile) {
    const primary = assemblies.get(config.modules[0])!;
    fs.mkdirSync(path.dirname(options.overviewFile), { recursive: true });
    const content = options.overviewSourceFile
      ? fs.readFileSync(options.overviewSourceFile, 'utf-8')
      : withHistory(renderApiOverviewPage(primary, {
        moduleFqn: primary.name,
        languages: languageIds,
        tablet: tabletFor(config.modules[0]),
      }), readmeHistory(ledger, primary.name));
    emitPageFile(options.overviewFile, `${API_ROOT}index.md`, content);
  }

  // First pass: group types for every module and collect a global
  // FQN -> page link map, so pages can cross-link types in other
  // modules (e.g. a mixin page listing its implementing constructs).
  const moduleGroups = new Map<string, Map<string, TypeEntry[]>>();
  const pageLinks = new Map<string, string>();
  for (const moduleName of config.modules) {
    const assembly = assemblies.get(moduleName)!;
    const groups = groupTypes(
      assembly,
      typeIndex,
      mixinIndex,
      mixinClassIndex,
      facadeIndex,
      traitIndex,
      config.includeKinds?.[moduleName],
    );
    moduleGroups.set(moduleName, groups);
    for (const entries of groups.values()) {
      for (const entry of entries) {
        pageLinks.set(entry.type.fqn, entry.link);
      }
    }
  }
  const linkFor = (fqn: string) => pageLinks.get(fqn);

  // Type-summary lookup for hover tooltips: keyed by page link so the client can resolve any cross-reference anchor.
  if (options.publicDir) {
    const summaries: Record<
      string,
      { name: string; kind: string; summary: string; label?: string; level?: string }
    > = {};
    for (const groups of moduleGroups.values()) {
      for (const entries of groups.values()) {
        for (const entry of entries) {
          summaries[entry.link] = {
            name: entry.name,
            kind: entry.kind,
            summary: entry.summary,
            // Reader-facing label and level for the preview's kind chip, from the SAME helper the H1 badge uses so
            // the two surfaces cannot drift. `kind` is left alone because it is a classification value, not a label:
            // `searchKind` derives the Pagefind filter from its first word. `level` is the canonical `ConstructLevel`
            // — the same form the sidebar nav data emits — so one field name never means two things. Emitted only for
            // leveled constructs.
            ...(entry.level
              ? { label: constructLevelLabel(entry.level), level: entry.level }
              : {}),
          };
        }
      }
    }
    fs.mkdirSync(options.publicDir, { recursive: true });
    const summariesFile = path.join(options.publicDir, 'type-summaries.json');
    fs.writeFileSync(summariesFile, JSON.stringify(summaries));
    written.push(summariesFile);
  }

  for (const moduleName of config.modules) {
    const assembly = assemblies.get(moduleName)!;
    const moduleLink = moduleReadmeLink(assembly.name);
    // Keyed by the node_modules directory, not `assembly.name`: the directory is what ships the tablet.
    const tablet = tabletFor(moduleName);

    const groups = moduleGroups.get(moduleName)!;
    const rootTypes = groups.get('') ?? [];
    // Above the H1 of every page this package owns; empty for a stable package.
    const banner = renderExperimentalBanner(assembly);
    const submoduleNames = [...groups.keys()].filter((k) => k !== '').sort();
    // Which submodules actually get an overview page in THIS build, so a breadcrumb segment for an intermediate
    // grouping links only when there is something to link to.
    const emittedSubmodules = new Set(submoduleNames);

    // Dedicated page for every type, dispatched by kind. A type introduced in the documented minor line gets an
    // `Added in vX.Y.Z` badge; its shape history renders inside the page's metadata block.
    for (const [submodule, entries] of groups) {
      for (const entry of entries) {
        // No package + version tag: the package is already in the breadcrumb and the version is site-wide; the
        // `Added in` badge is `emitPage`'s, from the ledger.
        const history = typeHistory(ledger, entry.type.fqn);
        // Pagefind `module:`/`kind:` filters so search queries can be scoped, e.g.
        // `bucket module:aws-s3 kind:construct`.
        const filters = searchFilterHtml({
          module: searchModule(assembly.name, submodule),
          kind: searchKind(entry.kind),
        });
        const page = renderPage(
          entry, assembly, typeIndex, mixinIndex, usageIndex, linkFor, languageIds, tablet,
          config.emitExamples?.[moduleName] ?? true,
          implementorsIndex, subclassIndex, history,
        );
        // Breadcrumb module hierarchy above the H1. Built here — the only layer that knows the module and submodule
        // page links.
        const breadcrumb = renderBreadcrumb([
          { label: assembly.name, link: moduleLink },
          ...submoduleSegments(assembly.name, submodule, emittedSubmodules),
          { label: entry.name },
        ]);
        emitPage(
          entry.link,
          `${typePageFrontmatter(entry.name).join('\n')}\n${breadcrumb.join('\n')}\n${banner.join('\n')}${page}\n\n${filters}\n`,
          history,
        );
      }
    }

    // Per-submodule pages: README first (when the assembly carries one), then the interactive type preview list.
    for (const sub of submoduleNames) {
      // The README the overview shows is the configured one rather than unconditionally this submodule's own.
      const subId = `${assembly.name}.${sub}`;
      const overview = resolveOverview(subId);
      // Overview breadcrumb: package . submodule (current, unlinked) — the same trail scheme as type pages, which
      // start at the package and carry no synthetic root above it. A dotted structural submodule contributes one
      // segment per part, so overview and type pages read the same trail.
      const breadcrumb = renderBreadcrumb([
        { label: assembly.name, link: moduleLink },
        ...submoduleSegments(assembly.name, sub, emittedSubmodules, { linkLast: false }),
      ]);
      const page = renderOverviewPage({
        title: subId,
        types: groups.get(sub)!,
        ...(overview.generated
          ? {}
          : {
            ...(overview.readme ? { readme: overview.readme } : {}),
            ...(overview.upstream ? { upstreamEditUrl: overview.upstream } : {}),
            examples: overview.examples,
          }),
        breadcrumb,
        banner,
      });
      const filters = searchFilterHtml({ module: searchModule(assembly.name, sub) });
      emitOverview(subId, moduleReadmeLink(assembly.name, sub), `${page}\n\n${filters}\n`, readmeHistory(ledger, subId));
    }

    // Sidebar entries: one per type, grouped by service later
    for (const [submodule, entries] of groups) {
      const indexLink = submodule
        ? moduleReadmeLink(assembly.name, submodule)
        : moduleLink;
      // Per-language module display names for the tree's label variants; undefined on single-language builds.
      const moduleLabels = sidebarModuleLabels(assembly, submodule, languageIds);
      const experimental = assembly.docs?.stability === 'experimental';
      for (const entry of entries) {
        sidebarEntries.push({
          name: entry.name,
          kind: entry.kind,
          link: entry.link,
          assemblyName: assembly.name,
          submodule,
          indexLink,
          ...(entry.level ? { level: entry.level } : {}),
          ...(moduleLabels ? { moduleLabels } : {}),
          ...(experimental ? { experimental } : {}),
        });
      }
    }

    // Package overview page (the `<docId>-readme` page). Same renderer as submodule overviews: the separate-install
    // alert, then the module README, then the submodule links and the root type list. `kind: 'generated'` opts back
    // in to the artificial index page.
    const rootOverview = resolveOverview(assembly.name);
    if (rootOverview.generated) {
      emitOverview(assembly.name, moduleLink, renderModuleIndex(assembly, rootTypes, submoduleNames), readmeHistory(ledger, assembly.name));
    } else {
      const sections: string[] = [];
      if (submoduleNames.length > 0) {
        sections.push(anchoredHeading(2, 'Submodules', SECTION_ANCHORS.submodules), '');
        for (const sub of submoduleNames) {
          sections.push(`- [${sub}](${moduleReadmeLink(assembly.name, sub)})`);
        }
        sections.push('');
      }
      emitOverview(assembly.name, moduleLink, renderOverviewPage({
        title: assembly.name,
        types: rootTypes,
        ...(rootOverview.readme ? { readme: rootOverview.readme } : {}),
        ...(rootOverview.upstream ? { upstreamEditUrl: rootOverview.upstream } : {}),
        examples: rootOverview.examples,
        // Anchored at the module itself, with no synthetic root segment above it — same trail scheme as type pages.
        breadcrumb: renderBreadcrumb([{ label: assembly.name }]),
        banner,
        // The documented version is a fact the README cannot carry, so it is emitted here. The assembly description
        // is not: the README's own opening prose says the same thing at length, directly below.
        preamble: [`> Version ${assembly.version}`, '', ...renderSeparateInstallAlert(assembly)],
        sections,
      }), readmeHistory(ledger, assembly.name));
    }

  }

  // Sidebar consumed by docs/.vitepress/config.mts: grouped by AWS service, then resource type. With 2+ enabled
  // languages, language-variant items carry per-language display labels.
  const sidebar: SidebarItem[] = buildServiceSidebar(sidebarEntries, languageIds);
  const sidebarFile = path.join(options.outDir, 'sidebar.json');
  fs.writeFileSync(sidebarFile, JSON.stringify(sidebar, null, 2));
  written.push(sidebarFile);

  // Served static assets under docs/public/api-sidebar/: sidebar.<hash>.js is the skeleton (section nodes without
  // items), chunks/<name>.<hash>.js holds one section's items, and symbols.<hash>.js is the navbar type-ahead index.
  // One tree serves every language; the theme fetches the skeleton once per session plus the chunks it needs, instead
  // of VitePress inlining the ~21.9k-entry tree into every page.
  if (options.publicDir) {
    const apiSidebarDir = path.join(options.publicDir, 'api-sidebar');
    // Cleared first: a hashed name changes with its content, so the previous build's files would otherwise pile up.
    fs.rmSync(apiSidebarDir, { recursive: true, force: true });
    const chunksDir = path.join(apiSidebarDir, 'chunks');
    fs.mkdirSync(chunksDir, { recursive: true });
    const { skeleton, chunks } = splitSidebarChunks(sidebar);
    const chunkFiles = new Map<string, string>();
    for (const chunk of chunks) {
      const body = JSON.stringify(chunk.items);
      const file = hashedAssetName(chunk.chunk, body);
      fs.writeFileSync(path.join(chunksDir, file), body);
      written.push(path.join(chunksDir, file));
      chunkFiles.set(chunk.chunk, file);
    }
    // The skeleton names each chunk's hashed file, so no chunk needs resolving against a manifest.
    const skeletonBody = JSON.stringify(renameChunks(skeleton, (chunk) => chunkFiles.get(chunk)!));
    const assetFile = path.join(apiSidebarDir, hashedAssetName('sidebar', skeletonBody));
    fs.writeFileSync(assetFile, skeletonBody);
    written.push(assetFile);

    const symbolsBody = JSON.stringify(buildSymbolIndex(sidebarEntries));
    const symbolsFile = path.join(apiSidebarDir, hashedAssetName('symbols', symbolsBody));
    fs.writeFileSync(symbolsFile, symbolsBody);
    written.push(symbolsFile);
  }

  // Site-scoped `llms.txt` at the root of the twin tree, so the overlay that places the twins into the site places
  // the index beside `sitemap.xml`. Every shard's docgen run writes the identical file, so the merge needs no union.
  if (options.agentOutDir) {
    const llmsFile = path.join(options.agentOutDir, 'llms.txt');
    fs.writeFileSync(llmsFile, renderLlmsTxt({
      siteTitle: SITE_TITLE,
      version: assemblies.get(config.modules[0])!.version,
      siteUrl: docsSiteUrl(),
      entries: llmsEntries,
    }));
    written.push(llmsFile);
  }

  return written;
}

/**
 * Breadcrumb segments for a submodule identifier: one per dotted part.
 *
 * Structural submodules carry dotted identifiers — `interfaces.aws_s3` mirrors the package tree and `aws_s3.mixins`
 * holds a service's mixins — and each dotted part becomes its own crumb: `aws-cdk-lib . interfaces . aws_s3 .
 * IBucketRef`. Plain submodules have no dot and so are unaffected.
 *
 * A part links to its own overview page only when `emitted` says this build produced one, so a bare grouping like
 * `interfaces` without a page yields an unlinked segment rather than a dead link. `linkLast: false` is for the
 * submodule overview page itself, whose final part IS the current page.
 *
 * Display only: page URLs, filenames and anchors are untouched.
 */
export function submoduleSegments(
  assemblyName: string,
  submodule: string,
  emitted: ReadonlySet<string>,
  options: { readonly linkLast?: boolean } = {},
): BreadcrumbSegment[] {
  if (!submodule) {
    return [];
  }
  const parts = submodule.split('.');
  return parts.map((part, i) => {
    const prefix = parts.slice(0, i + 1).join('.');
    const isLast = i === parts.length - 1;
    const link = isLast ? options.linkLast !== false : emitted.has(prefix);
    return link ? { label: part, link: moduleReadmeLink(assemblyName, prefix) } : { label: part };
  });
}

/**
 * Group assembly types by submodule ('' = module root). Only real jsii submodules count; namespaces created by
 * nested types (e.g. `CfnBucket.PolicyProperty`) fold into their closest enclosing submodule.
 *
 * Links live in the single canonical page tree.
 */
function groupTypes(
  assembly: spec.Assembly,
  index: TypeIndex,
  mixins: MixinIndex,
  mixinClasses: ReadonlySet<string>,
  facades: ReadonlySet<string>,
  traits: ReadonlySet<string>,
  includeKinds?: readonly string[],
): Map<string, TypeEntry[]> {
  const submoduleFqns = new Set(Object.keys(assembly.submodules ?? {}));
  const submoduleOf = (namespace?: string): string => {
    if (!namespace) {
      return '';
    }
    const parts = namespace.split('.');
    for (let i = parts.length; i > 0; i--) {
      const prefix = parts.slice(0, i).join('.');
      if (submoduleFqns.has(`${assembly.name}.${prefix}`)) {
        return prefix;
      }
    }
    return '';
  };

  const groups = new Map<string, TypeEntry[]>();
  const observedKinds = new Set<string>();
  for (const type of Object.values(assembly.types ?? {})) {
    const submodule = submoduleOf(type.namespace);
    const name = type.namespace && type.namespace !== submodule
      ? `${type.namespace.slice(submodule ? submodule.length + 1 : 0)}.${type.name}`
      : type.name;

    let kind = typeKind(type);
    let level: ConstructLevel | undefined;
    if (spec.isClassType(type) && isConstruct(type.fqn, index)) {
      level = constructLevel(type, index);
      kind = level ? `Construct (${level})` : 'Construct';
    } else if (mixins.has(type.fqn) || mixinClasses.has(type.fqn)) {
      kind = 'Mixin';
    } else if (facades.has(type.fqn)) {
      // Resource-specific integration class per the CDK design guidelines — grouped apart from plain classes.
      kind = 'Facade';
    } else if (traits.has(type.fqn)) {
      // Service-agnostic capability contract (trait interface or its factory) per the CDK design guidelines.
      kind = 'Trait';
    }
    observedKinds.add(kind);
    if (includeKinds && !includeKinds.includes(kind)) {
      continue;
    }
    const link = typePageLink(assembly.name, submodule, name);

    const entry: TypeEntry = {
      name,
      kind,
      summary: type.docs?.summary ?? '',
      link,
      type,
      ...(level ? { level } : {}),
    };
    const list = groups.get(submodule) ?? [];
    list.push(entry);
    groups.set(submodule, list);
  }
  if (includeKinds) {
    const unknownKinds = includeKinds.filter((kind) => !observedKinds.has(kind));
    if (unknownKinds.length > 0) {
      throw new Error(`${assembly.name}: unknown includeKinds classifications: ${unknownKinds.join(', ')}`);
    }
  }
  for (const list of groups.values()) {
    // Same order the sidebar uses: constructs L3 -> L2 -> L1, then everything unleveled, alphabetical within each
    // tier.
    list.sort(byLevelThenName);
  }
  return groups;
}

function typeKind(type: spec.Type): string {
  if (spec.isClassType(type)) {
    return 'Class';
  }
  if (spec.isInterfaceType(type)) {
    return type.datatype ? 'Struct' : 'Interface';
  }
  if (spec.isEnumType(type)) {
    return 'Enum';
  }
  return 'Type';
}

/**
 * Heading badge for a classification that differs from the jsii kind. `Mixin` is overridden so a class-based mixin
 * badges itself the same way an interface mixin does; `Facade` is classified and labeled everywhere else, so its
 * page badges itself `Facade` rather than a plain `Class`. Any kind absent here keeps the neutral `Class` badge.
 */
const KIND_BADGE: Readonly<Record<string, { text: string; type: string; kindClass: string } | undefined>> = {
  Mixin: { text: 'Mixin', type: 'tip', kindClass: 'api-badge-mixin' },
  Facade: { text: 'Facade', type: 'tip', kindClass: 'api-badge-facade' },
};

/** Dispatch a type to its page renderer based on classification. */
function renderPage(
  entry: TypeEntry,
  assembly: spec.Assembly,
  index: TypeIndex,
  mixins: MixinIndex,
  usage: UsageIndex,
  linkFor: (fqn: string) => string | undefined,
  languages: readonly Language[],
  tablet: RosettaTablet,
  emitExamples: boolean,
  implementors?: ReadonlyMap<string, readonly string[]>,
  subclasses?: ReadonlyMap<string, readonly string[]>,
  history: PageHistory = {},
): string {
  // Every enabled language's variant regions are embedded in the one rendered page; with a single language the
  // renderers emit that language's canonical output unwrapped.
  const { type } = entry;
  return pinTitleAnchor(
    renderTypePage(entry, assembly, index, mixins, usage, linkFor, languages, tablet, emitExamples, implementors, subclasses, history),
    titleAnchor(type, index, entry.kind === 'Mixin'),
  );
}

function renderTypePage(
  entry: TypeEntry,
  assembly: spec.Assembly,
  index: TypeIndex,
  mixins: MixinIndex,
  usage: UsageIndex,
  linkFor: (fqn: string) => string | undefined,
  languages: readonly Language[],
  tablet: RosettaTablet,
  emitExamples: boolean,
  implementors: ReadonlyMap<string, readonly string[]> | undefined,
  subclasses: ReadonlyMap<string, readonly string[]> | undefined,
  history: PageHistory,
): string {
  const { type } = entry;
  if (spec.isClassType(type)) {
    return isConstruct(type.fqn, index)
      ? renderConstructPage({ type, assembly, index, linkFor, languages, subclasses, tablet, emitExamples, history })
      : renderClassPage({
        type,
        assembly,
        index,
        usage,
        linkFor,
        languages,
        subclasses,
        tablet,
        emitExamples,
        history,
        // A class-based mixin is grouped as `Mixin` in the index table, the sidebar and the search filter, so its
        // own page badges itself the same way, in the same color renderMixinPage gives an interface mixin. A Facade
        // is classified by `buildFacadeIndex` and labeled Facade elsewhere, so its page badges itself Facade too.
        badge: KIND_BADGE[entry.kind],
      });
  }
  if (spec.isInterfaceType(type)) {
    if (mixins.has(type.fqn)) {
      return renderMixinPage({ type, assembly, index, mixins, linkFor, languages, history });
    }
    return type.datatype
      ? renderStructPage({ type, assembly, index, usage, linkFor, languages, emitExamples, history })
      : renderInterfacePage({ type, assembly, index, usage, linkFor, languages, emitExamples, implementors, history });
  }
  if (spec.isEnumType(type)) {
    return renderEnumPage({ type, assembly, index, usage, linkFor, languages, emitExamples, history });
  }
  return [`# ${entry.name}`, '', entry.summary, ''].join('\n');
}

/**
 * Experimental banner for every page of an experimental (alpha) package: the module overview, each submodule
 * overview and each type page. Emitted above the H1 so the level is the first thing a reader sees, as a VitePress
 * `warning` custom container — the same block the separate-install alert uses, so the two read as one family.
 * Empty for a stable package: the absence of the banner is the stable indicator.
 *
 * Keyed on the package, not the type: a type marked experimental inside a stable package keeps its metadata row
 * and gets no banner, because the banner states a fact about the package the page belongs to.
 */
export function renderExperimentalBanner(assembly: spec.Assembly): string[] {
  if (assembly.docs?.stability !== 'experimental') {
    return [];
  }
  return [
    '::: warning Experimental',
    `\`${assembly.name}\` is an [**experimental**](${STABILITY_ROUTE}) (alpha) package: its API may change in any`
      + ' release, without a major version bump.',
    ':::',
    '',
  ];
}

/**
 * Separate-package alert for standalone (non-`aws-cdk-lib`) modules: these packages do not ship inside
 * `aws-cdk-lib`, so their module page states the extra install up front. Emitted as a VitePress custom container —
 * markdown-it syntax, so no raw-HTML/Vue-compile concerns in the sharded build. The API-stability caveat is not
 * repeated here: the experimental banner above the title carries it.
 */
export function renderSeparateInstallAlert(assembly: spec.Assembly): string[] {
  if (assembly.name === 'aws-cdk-lib') {
    return [];
  }
  const pipName = assembly.targets?.python?.distName;
  return [
    '::: info Separate package',
    `\`${assembly.name}\` is not part of \`aws-cdk-lib\` — install it separately:`,
    '',
    ...codeFence([`npm install ${assembly.name}`, ...(pipName ? [`pip install ${pipName}`] : [])].join('\n'), 'sh'),
    ':::',
    '',
  ];
}

/**
 * YAML frontmatter that hides VitePress's right-hand "On this page" outline — applied ONLY where the outline merely
 * mirrors the navigation the left sidebar already provides: module index pages (`## Submodules` / `## Types`) and
 * table-only submodule pages. README-backed pages keep their outline: their README section headings are quick
 * navigation the sidebar does not cover. `outline: false` is VitePress's per-page toggle; the aside column itself is
 * kept (no `aside: false`) so these pages keep the same content width as every other page.
 */
const OVERVIEW_FRONTMATTER = ['---', 'outline: false', '---', ''];

/**
 * Frontmatter for a type page: the bare type name as an explicit title.
 *
 * Two constraints not visible from the code:
 *
 * - It must be the file's FIRST bytes. VitePress parses a frontmatter block only at the very top and silently
 *   ignores it anywhere else, so anything inserted above this silently restores H1 inference.
 * - The type name is stated explicitly because the H1 carries a source chip whose inner text would otherwise leak
 *   into VitePress's inferred title.
 */
function typePageFrontmatter(name: string): readonly string[] {
  return ['---', `title: ${JSON.stringify(name)}`, '---', ''];
}

/** The recorded history as frontmatter keys, one per known value; a page with no history is returned untouched. */
function withHistoryFrontmatter(page: string, history: PageHistory): string {
  let out = page;
  for (const key of ['introducedIn', 'lastChangedIn', 'lastChangedAt'] as const) {
    const value = history[key];
    if (value) {
      out = withFrontmatterKey(out, HISTORY_FRONTMATTER[key], value);
    }
  }
  return out;
}

/**
 * Frontmatter for an overview page, carrying the upstream README URL through to the theme alongside whatever else
 * the page needs. The URL is quoted because a bare `https://…` scalar puts a colon in a YAML value, and `[]` means
 * the page emits no frontmatter block at all — the README-backed default, which keeps its outline.
 */
function overviewFrontmatter(keys: readonly string[]): readonly string[] {
  return keys.length > 0 ? ['---', ...keys, '---', ''] : [];
}

/** `upstreamEditUrl` frontmatter key, or nothing when there is no upstream file. */
function upstreamKey(url: string | undefined): readonly string[] {
  return url ? [`upstreamEditUrl: ${JSON.stringify(url)}`] : [];
}

/**
 * Canonical line order for an overview page: `frontmatter → breadcrumb → banner → heading → body`. Routing every
 * overview page through one function keeps the breadcrumb and the experimental banner above the H1, matching type
 * pages.
 *
 * The first parts are order-critical rather than stylistic:
 *
 * - Frontmatter must be the very first thing in the file or VitePress does not parse it, silently losing
 *   `outline: false`.
 * - The breadcrumb is a `<nav>` block and the banner a custom container; neither contributes a heading, so placing
 *   them first leaves the H1 as the page's first heading — which VitePress derives the page title from when no
 *   `title:` is declared. Overview pages rely on that inference; the crumb must not become the first heading.
 *
 * Callers pass the breadcrumb already rendered, so it stays outside any `v-pre` container the body introduces.
 */
function overviewPage(parts: {
  frontmatter?: readonly string[];
  breadcrumb?: readonly string[];
  banner?: readonly string[];
  heading: string;
  body?: readonly string[];
}): string[] {
  return [
    ...(parts.frontmatter ?? []),
    ...(parts.breadcrumb ?? []),
    ...(parts.banner ?? []),
    parts.heading,
    '',
    ...(parts.body ?? []),
  ];
}

function renderModuleIndex(
  assembly: spec.Assembly,
  rootTypes: TypeEntry[],
  submodules: string[],
): string {
  const lines = overviewPage({
    frontmatter: OVERVIEW_FRONTMATTER,
    // Breadcrumb bar, rendered above the H1 like the type pages'. The trail is anchored at the module itself, with
    // no synthetic root segment. The bar is still emitted for a single-segment trail because it hosts the
    // `breadcrumb-fav` mount point the favorite star teleports into.
    breadcrumb: renderBreadcrumb([{ label: assembly.name }]),
    banner: renderExperimentalBanner(assembly),
    heading: `# ${assembly.name}`,
    body: [`> Version ${assembly.version}`, '', assembly.description ?? '', ''],
  });
  lines.push(...renderSeparateInstallAlert(assembly));
  if (submodules.length > 0) {
    lines.push(anchoredHeading(2, 'Submodules', SECTION_ANCHORS.submodules), '');
    for (const sub of submodules) {
      lines.push(`- [${sub}](${moduleReadmeLink(assembly.name, sub)})`);
    }
    lines.push('');
  }
  if (rootTypes.length > 0) {
    lines.push(anchoredHeading(2, 'Types', SECTION_ANCHORS.types), '', ...renderTypeTable(rootTypes), '');
  }
  return lines.join('\n');
}

/**
 * The `/api/` landing page: the primary module's root README — the real aws-cdk-lib overview — sourced from the
 * jsii assembly the docgen ingests, never a hand-copied snapshot. Rendered like the submodule start pages: the
 * README's own leading H1 becomes the page title (with an `# API Reference` fallback) and the README body sits in a
 * `<div v-pre>` container so mustache interpolation and template literals never reach the Vue compiler.
 */
export function renderApiOverviewPage(assembly: spec.Assembly, examples?: ReadmeExampleOptions): string {
  const body = assembly.readme?.markdown ? prepareReadme(assembly.readme.markdown) : '';
  const headingMatch = body ? /^#\s+(.*)(?:\n|$)/.exec(body) : null;
  const heading = headingMatch ? headingMatch[0].trimEnd() : '# API Reference';
  const rest = headingMatch ? body.slice(headingMatch[0].length).trim() : body;
  const lines: string[] = [
    // This page is the primary module's root README, so its edit link is that upstream file — the page itself is
    // generated and has no markdown in this repo to edit.
    ...(body ? overviewFrontmatter(upstreamKey(upstreamReadmeUrl(assembly, assembly.name))) : []),
    heading,
    '',
    // No "browse the modules" line: this page IS /api/, so it would be a self-link. The sidebar rail already carries
    // the Service → Resource → Kind tree.
  ];
  if (rest) {
    lines.push(...renderReadmeBody(rest, examples));
  }
  return lines.join('\n');
}

/** Inputs to {@link renderOverviewPage}. */
export interface OverviewPageOptions {
  /** Fallback page title, used when the README has no leading H1. */
  readonly title: string;
  /** Types listed on this page (root types for a package root). */
  readonly types: TypeEntry[];
  /** Resolved README markdown, or undefined for the table-only variant. */
  readonly readme?: string;
  /** Pre-rendered breadcrumb, emitted above the H1. */
  readonly breadcrumb?: string[];
  /** Pre-rendered experimental banner, emitted between the breadcrumb and the H1. */
  readonly banner?: readonly string[];
  readonly examples?: ReadmeExampleOptions;
  /**
   * Markdown emitted directly after the H1, above the README body — for
   * order-sensitive extras like the separate-install alert, which must
   * stay above the fold rather than below a long README.
   */
  readonly preamble?: readonly string[];
  /**
   * Markdown emitted after the README body and before the type list —
   * the package-root extras (submodule links) that no submodule has.
   */
  readonly sections?: readonly string[];
  /**
   * Upstream `README.md` URL this page's prose came from, emitted as frontmatter so the theme's doc footer can link
   * the file a reader can edit. Omitted when there is no such file, and the footer then renders no edit link.
   */
  readonly upstreamEditUrl?: string;
}

/**
 * Whether a module's overview page shows a README at all, and which text. Exhaustive over {@link OverviewSpec} so
 * adding a kind is a compile error here rather than a silent fallthrough to the default.
 *
 * `readme` and `copy` differ only in WHICH module's markdown the caller resolved, so both take the resolved text as
 * given here.
 *
 * `generated` never reaches this function: it is the artificial index page, dispatched before the README is
 * resolved.
 */
export function overviewReadme(
  overview: OverviewSpec,
  resolved: string | undefined,
): string | undefined {
  switch (overview.kind) {
    case 'readme':
    case 'copy':
      return resolved;
    case 'none':
      return undefined;
    case 'generated':
      throw new Error('overviewReadme: kind "generated" is not a README variant');
  }
}

/**
 * One overview-page renderer for package roots and submodules alike. The resolved README comes first, then the type
 * list. A module with no README (or `kind: 'none'`) gets the table-only layout.
 *
 * READMEs open with their own `# <Title>` heading, which becomes the page title; the `title` option is a fallback
 * used only when the README is missing or lacks a leading heading. The heading is emitted at the top level (so
 * VitePress still extracts the page title); the rest of the README body is wrapped in a `<div v-pre>` container.
 *
 * The right-hand "On this page" outline is suppressed only on the table-only variant, where it merely mirrors the
 * left sidebar. README-backed pages KEEP the outline — their section headings are rich quick navigation the sidebar
 * does not provide. The redundant inline `## Table of Contents` some READMEs open with is stripped instead (see
 * {@link stripInlineToc}).
 *
 * `v-pre` disables Vue template compilation for the whole embedded subtree, so mustache interpolation (`{{ … }}`)
 * and JS template literals (`${…}`) in the README prose OR inside code render literally instead of blowing up the
 * compiler. Escaping the braces (see {@link escapeProse}) is not enough because `{{ … }}` inside a code span
 * survives fence-aware escaping and still reaches Vue.
 */
export function renderOverviewPage(options: OverviewPageOptions): string {
  const { title, types, breadcrumb = [], banner = [], examples, preamble = [], sections = [] } = options;
  const body = options.readme ? prepareReadme(options.readme) : '';
  if (!body) {
    return overviewPage({
      frontmatter: overviewFrontmatter(['outline: false', ...upstreamKey(options.upstreamEditUrl)]),
      breadcrumb,
      banner,
      heading: `# ${title}`,
      body: [...preamble, ...sections, ...renderTypeTable(types), ''],
    }).join('\n');
  }
  // Hoist the README's leading H1 out of the v-pre container so the page
  // title/outline is a clean top-level heading; fall back to the fqn.
  const headingMatch = /^#\s+(.*)(?:\n|$)/.exec(body);
  const heading = headingMatch ? headingMatch[0].trimEnd() : `# ${title}`;
  const rest = headingMatch ? body.slice(headingMatch[0].length).trim() : body;
  // The breadcrumb sits OUTSIDE the v-pre container below — its markdown links must render as real anchors, which
  // v-pre would suppress. It renders ABOVE the heading so the trail sits where type pages put it; the README's own
  // H1 is still the first heading, so it remains the page title. No outline-off frontmatter here: README-backed
  // pages keep the right-hand quick nav.
  const lines: string[] = overviewPage({
    frontmatter: overviewFrontmatter([...upstreamKey(options.upstreamEditUrl)]),
    breadcrumb,
    banner,
    heading,
  });
  // Above the README body: a packaging/stability caveat is worthless below
  // a README that opens with its own install instructions.
  lines.push(...preamble);
  if (rest) {
    lines.push(...renderReadmeBody(rest, examples));
  }
  lines.push(...sections);
  lines.push(anchoredHeading(2, 'Types', SECTION_ANCHORS.types), '', ...renderTypeTable(types), '');
  return lines.join('\n');
}

/**
 * README example translation. A README body is emitted as an alternating sequence of prose blocks and example
 * blocks rather than one `<div v-pre>` container, because `<LanguageTabs>` is a Vue component and `v-pre` would
 * leave it uncompiled — the language toggle would never reach the README's fences and every language would show
 * TypeScript.
 *
 * Lifting a fence out of the container does not expose it to the Vue compiler: the shared `markdown.highlight` hook
 * in `config.mts` stamps `v-pre` onto every `<pre>` it emits, so mustache interpolation and template literals inside
 * a code fence stay literal. Only prose and inline code still need the container.
 *
 * Fences with no rosetta translation stay inside the prose container untouched, so an untranslated example degrades
 * to a plain TypeScript fence instead of an empty block. So does any fence indented inside a list item — only
 * column-0 fences are candidates (see `splitReadmeExamples`), because lifting a fence out of its list would
 * break the list structure.
 */
interface ReadmeExampleOptions {
  /** Fully-qualified module the README belongs to (tablet lookup key). */
  readonly moduleFqn: string;
  /** Enabled documentation languages. */
  readonly languages: readonly Language[];
  /** Translations for this assembly's README examples. */
  readonly tablet: RosettaTablet;
}

/**
 * Split a prepared README body into `<div v-pre>` prose blocks and
 * per-language example blocks. Without options (or with a single enabled
 * language, or no matching translations) the result is the previous
 * single-container rendering, byte for byte.
 */
function renderReadmeBody(body: string, options?: ReadmeExampleOptions): string[] {
  const segments = splitReadmeExamples(body, options);
  const lines: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'prose') {
      // Blank lines around the block let markdown-it re-enter markdown
      // parsing inside the raw-HTML container, so the body still renders
      // as markdown while `v-pre` shields it from the Vue compiler.
      lines.push('<div v-pre>', '', segment.text, '', '</div>', '');
    } else {
      lines.push(...languageVariantBlocks(
        options!.languages,
        // rosetta can legitimately fail to translate an individual snippet;
        // when a language is missing, the fallback wraps the authored
        // TypeScript source, so the fence must be tagged `ts` — stamping the
        // requested tab's language would highlight (and offer for copy)
        // TypeScript source mislabeled as that language.
        (lang) => {
          const translated = segment.translations[lang];
          return translated !== undefined
            ? fenceFor(translated, lang)
            : fenceFor(segment.original, 'ts');
        },
        // The fences compile into Shiki `language-<lang>` divs carrying VitePress's copy-code button, which `v-pre`
        // would ship dead on every non-canonical tab (see variants.ts).
        { hydrated: true },
      ));
    }
  }
  return lines;
}

/** One fenced code block in the given language. */
function fenceFor(source: string, lang: Language): string[] {
  return codeFence(source, FENCE_LANG[lang]);
}

type ReadmeSegment =
  | { readonly kind: 'prose'; readonly text: string }
  | {
    readonly kind: 'example';
    readonly original: string;
    readonly translations: ExampleTranslations;
  };

/**
 * Walk the README body, peeling off the column-0 fences that have
 * translations. Everything else — prose, inline code, untranslated fences,
 * and fences indented inside a list item (deliberately never lifted, since
 * that would break the enclosing list) — stays in the surrounding prose
 * segment so its rendering is unchanged.
 */
function splitReadmeExamples(body: string, options?: ReadmeExampleOptions): ReadmeSegment[] {
  if (!options || options.languages.length <= 1) {
    return body.trim() ? [{ kind: 'prose', text: body }] : [];
  }
  const segments: ReadmeSegment[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    const text = prose.join('\n').trim();
    if (text) segments.push({ kind: 'prose', text });
    prose = [];
  };
  for (const span of tokenizeFences(body)) {
    if (span.kind === 'code' && span.closed && span.indent === 0 && span.run === 3) {
      const inner = span.text.split('\n').slice(1, -1).join('\n');
      const translations = options.tablet.translationsFor(options.moduleFqn, inner ? `${inner}\n` : '');
      if (translations) {
        flushProse();
        segments.push({ kind: 'example', original: inner, translations });
        continue;
      }
    }
    prose.push(span.text);
  }
  flushProse();
  return segments;
}

/**
 * Prepare a jsii submodule README for embedding in a VitePress page:
 * outside code, strip HTML comments and neutralize repo-relative
 * image/link targets, then escape Vue-hostile characters fence-aware.
 * Returns '' for effectively-empty READMEs so callers can fall back to
 * the table-only layout.
 *
 * Repo-relative `![](./img.png)` / `[](../doc.md)` targets are stripped
 * because Vite treats a relative `![]()` image as a build-time asset to
 * bundle and hard-fails when the source (which lives in the CDK repo,
 * not the docs tree) cannot be resolved — this is a bundler error that
 * `ignoreDeadLinks` does not catch. Images collapse to their alt text,
 * links to their label; absolute URLs, root-absolute paths and anchors
 * are left untouched.
 */
function prepareReadme(markdown: string): string {
  const cleaned = mapProse(
    stripInlineToc(closeDanglingFence(markdown)),
    (prose) => stripRelativeRefs(removeAll(prose, /<!--[\s\S]*?-->/g)),
  );
  return labelEmptyTableHeaders(convertMathFences(escapeProse(cleaned))).trim();
}

/** Give a blank leading Markdown table header an accessible row-dimension label. */
export function labelEmptyTableHeaders(markdown: string): string {
  return tokenizeFences(markdown)
    .map((span) => span.kind === 'code'
      ? span.text
      : span.text.replace(
        /^(\|[ \t]*)\|(?=[^\n]*\|[ \t]*\n[ \t]*\|[ \t]*:?-{3,}:?[ \t]*\|)/gm,
        '$1<span class="visually-hidden">Row</span> |',
      ))
    .join('\n');
}

/**
 * Terminate a README whose last code fence was never closed. Published jsii
 * READMEs are not validated markdown, and an unclosed opener swallows the
 * `</div>` of the surrounding `v-pre` container, failing the shard build.
 *
 * A fence closes only on the marker that opened it, at least as long and with
 * no info string, so balancing cannot append a fence to a balanced README.
 */
export function closeDanglingFence(markdown: string): string {
  const spans = tokenizeFences(markdown);
  const last = spans[spans.length - 1];
  // A quoted fence already ends with its blockquote, so a column-0 closer
  // appended for it would be a NEW dangling opener — skip those.
  if (!last || last.kind !== 'code' || last.closed || last.depth! > 0) return markdown;
  return `${markdown.replace(/\s*$/, '')}\n${last.marker!.repeat(last.run!)}\n`;
}

/**
 * Strip a literal inline "Table of Contents" section from a README: several jsii READMEs (e.g. aws-apigateway) open
 * with a `## Table of Contents` heading followed by a long link list that duplicates the right-hand "On this page"
 * outline while pushing the content a screenful down, so it is dropped at generate time. Fence-aware line scan: a
 * matching heading inside a code fence is never touched. The strip removes the ToC heading plus the list items and
 * blank lines that follow it, ending at the first line that is neither (usually the next `##` heading), so it can
 * never eat real prose.
 */
export function stripInlineToc(markdown: string): string {
  return tokenizeFences(markdown)
    .map((span) => {
      if (span.kind === 'code') return span.text;
      const out: string[] = [];
      let skipping = false;
      for (const line of span.text.split('\n')) {
        if (!skipping && /^#{1,6}\s+table of contents\s*$/i.test(line)) {
          skipping = true;
          continue;
        }
        if (skipping) {
          // Blank lines and (nested) list items belong to the ToC list.
          if (/^\s*$/.test(line) || /^\s*([-*+]|\d+[.)])\s/.test(line)) {
            continue;
          }
          skipping = false;
        }
        out.push(line);
      }
      return out.join('\n');
    })
    .join('\n');
}

/**
 * Rewrite GitHub-flavored math notation into the `$…$` / `$$…$$` delimiters VitePress's math support
 * (markdown-it-mathjax3) understands. GitHub typesets ` ```math ` fences and `` $`…`$ `` inline spans as equations,
 * but VitePress treats `math` as a code-block language, has no such grammar, and degrades the block to plain text.
 * Rewriting the fence into a display-math block removes the `math` fence entirely and feeds real TeX to mathjax3,
 * which typesets it at build time into static markup, safe inside the page's `v-pre` container.
 *
 * Must run AFTER {@link escapeProse}: while the math is still a fence its interior is protected from brace-escaping,
 * and once rewritten to `$$…$$` the TeX braces (e.g. `A_{vCpus}`) must stay literal for MathJax to parse.
 */
export function convertMathFences(text: string): string {
  return tokenizeFences(text)
    .map((span) => {
      if (span.kind === 'code') {
        // Fenced block whose info-string is `math` -> display math.
        if (span.closed && span.info!.trim() === 'math') {
          const body = span.text.split('\n').slice(1, -1).join('\n');
          return `$$\n${body}\n$$`;
        }
        return span.text;
      }
      // GitHub inline math `` $`expr`$ `` -> `$expr$`, outside fences.
      return span.text.replace(/\$`([^`\n]+)`\$/g, (_m, expr) => `$${expr}$`);
    })
    .join('\n');
}

/** True for a link/image target that cannot resolve in the docs tree. */
function isRelativeTarget(target: string): boolean {
  const t = target.trim();
  if (!t) return false;
  // Anchors, root-absolute (incl. protocol-relative `//`), and any URI
  // with an explicit scheme (http:, https:, mailto:, data:, …) resolve.
  return !/^(#|\/|[a-z][a-z0-9+.-]*:)/i.test(t);
}

/**
 * Collapse repo-relative markdown images to their alt text and relative
 * links to their label. Operates on a non-code markdown segment.
 */
function stripRelativeRefs(text: string): string {
  return text
    // Images first (leading `!`): `![alt](./x.png)` -> `alt`.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, target) =>
      (isRelativeTarget(target) ? alt : m))
    // Then links: `[label](../x.md)` -> `label`.
    .replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, target) =>
      (isRelativeTarget(target) ? label : m));
}

function renderTypeTable(types: TypeEntry[]): string[] {
  return [
    '| Name | Kind | Summary |',
    '| --- | --- | --- |',
    ...types.map((t) => {
      const name = t.link ? `[\`${t.name}\`](${t.link})` : `\`${t.name}\``;
      return `| ${name} | ${t.kind} | ${escapeCell(t.summary)} |`;
    }),
  ];
}
