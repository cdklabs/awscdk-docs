/**
 * Client-side logic for the lazy-loaded API sidebar.
 *
 * The generated Service -> Resource -> Kind tree (one leaf per documented type,
 * ~21.9k entries) is emitted once by docgen as static assets under
 * `docs/public/api-sidebar/` — a skeleton of section nodes plus one chunk per
 * section — rather than inlined into every API page. The `ApiSidebar`
 * component fetches the skeleton once per session and a chunk when its section
 * is needed, and renders native `<a>` links, preserving SPA navigation,
 * active-state, the mobile drawer, and theming.
 *
 * Framework-free (no Vue, no DOM, no fetch at import time) so these helpers can
 * be unit-tested in plain Node.
 */

import { serviceRows } from '../../../src/sidebar-rows';

export type ApiSidebarKind =
  | 'construct'
  | 'mixin'
  | 'class'
  | 'struct'
  | 'interface'
  | 'enum'
  | 'cfn-resource'
  | 'cfn-property';

export type ApiSidebarPackageModuleData = readonly [
  flags: string,
  scopedAssemblies: readonly string[],
  extras?: readonly (readonly [fqn: string, flags: number])[],
];

export interface ApiSidebarPackageModule {
  readonly fqn: string;
  readonly assembly: string;
  readonly service: boolean;
  readonly cloudFormationOnly: boolean;
  readonly overview?: string;
  readonly sectionStems: readonly string[];
}

export interface ApiSidebarNode {
  readonly text: string;
  /**
   * Canonical display label when it should differ from `text`: nested type names
   * keep their owner-qualified `text` (`CfnBucket.PolicyProperty`) as identity
   * while displaying only the last FQN segment (`PolicyProperty`). Absent when
   * they coincide.
   */
  readonly label?: string;
  /** Site-absolute link to a page (leaves only). */
  readonly link?: string;
  /** Whether a group starts collapsed (advisory; runtime state is separate). */
  readonly collapsed?: boolean;
  /**
   * Per-language display labels. `text` is the canonical (language-stable) label
   * and doubles as the node's stable identity (group keys, filter matching);
   * only languages whose display differs are present. Absent on single-language
   * builds.
   */
  readonly labels?: Readonly<Record<string, string>>;
  /**
   * Fixed structural header: renders as a non-collapsible section heading with
   * its children always visible — the top-level Framework / Services nodes.
   * Never toggles, so it needs no expansion-state key.
   */
  readonly section?: boolean;
  /**
   * Marks a kind group (Constructs / Mixins / Facades / Traits / Others) so the
   * tree can de-emphasize it without guessing from depth. Read by
   * `ApiSidebarItem.vue` as the `data-kind-group` attribute the stylesheet keys
   * that de-emphasis on; survives filtering via `filterSidebarTree`'s node
   * spread. Absent on everything that is not a kind group.
   */
  readonly kindGroup?: boolean;
  /**
   * Construct level of a leaf, rendered as a compact tag before the name. Kept
   * out of `text`/`label` because those are the node's identity (group keys,
   * filter matching), so a level folded into the label would make `Bucket` match
   * a filter for `l2`. Absent on groups and non-leveled constructs.
   */
  readonly level?: 'L1' | 'L2' | 'L3';
  /** Owning jsii module FQN for a type leaf. */
  readonly module?: string;
  /** Stable package-view kind for a type leaf. */
  readonly kind?: ApiSidebarKind;
  /** Compact module metadata used to regroup existing leaves by package. Present on the served skeleton root only. */
  readonly packageModules?: ApiSidebarPackageModuleData;
  /** Whether a package entry contains only CloudFormation types. */
  readonly cloudFormationOnly?: boolean;
  /** Chunk files needed to materialize a package-view entry. */
  readonly chunks?: readonly string[];
  /** Page-id stems (`<docId>[.<submodule>]`) whose pages this section owns. Section nodes only. */
  readonly modules?: readonly string[];
  /** Name of the chunk file holding this section's items, which the served skeleton omits. */
  readonly chunk?: string;
  /**
   * A number shown at the row's right edge. On a Services section of the served skeleton, docgen's construct
   * count (`src/sidebar-rows.ts`); on the rows the Services view derives (`servicesViewTree`), the row count of
   * the `Constructs` and `Types` parts and of a kind group, and a module row's type count. Absent everywhere else.
   */
  readonly count?: number;
  /**
   * A part of an open service in the Services view (`Modules`, `Constructs`, `Types`): a non-interactive
   * sub-heading whose rows are always visible and sit at the part's own depth. Client-derived only.
   */
  readonly part?: boolean;
  /** A module row of the Services view: the overview link of a service's other module, named by its id. */
  readonly moduleRow?: boolean;
  readonly items?: ApiSidebarNode[];
}

/**
 * The label to display for a node under the active language: the language's
 * variant when the generated tree carries one, else the canonical short label,
 * else the canonical text. Links and group keys always use the canonical text
 * (the filter matches the label too), so display shortening and language
 * switching relabel in place.
 */
export function displayLabel(node: ApiSidebarNode, lang: string): string {
  return node.labels?.[lang] ?? node.label ?? node.text;
}

/** Separator for composing a group's stable key from its ancestor texts. */
const KEY_SEP = '\u0000';

/**
 * Normalize a path for comparison: drop the site base, any leading slash, a
 * `.html` suffix, a trailing `/index`, and a trailing slash. VitePress route
 * paths carry the base and may end in `.html`; generated sidebar links are
 * clean and site-absolute, so both sides must be normalized before an
 * equality check.
 */
export function normalizePath(path: string, base = '/'): string {
  let p = path;
  if (base && base !== '/') {
    const trimmed = base.replace(/\/+$/, '');
    if (p === trimmed) {
      p = '/';
    } else if (p.startsWith(trimmed + '/')) {
      p = p.slice(trimmed.length);
    }
  }
  return p
    .replace(/^\/+/, '')
    .replace(/\.html$/, '')
    .replace(/\/index$/, '')
    .replace(/\/+$/, '');
}

/** Site-absolute path of a served api-sidebar asset, by the hashed filename themeConfig carries; empty when absent. */
export function apiSidebarAsset(file: string): string {
  return file ? `/api-sidebar/${file}` : '';
}

/** Site-absolute path of the chunk file holding one section's items, named by the skeleton. */
export function chunkAsset(chunk: string): string {
  return `/api-sidebar/chunks/${chunk}`;
}

/** Stable key for a group node: the path of its ancestor texts. */
export function groupKey(parentKey: string, text: string): string {
  return parentKey ? `${parentKey}${KEY_SEP}${text}` : text;
}

function isLeaf(node: ApiSidebarNode): boolean {
  return !node.chunk && (!node.items || node.items.length === 0);
}

/** Whether a section's items are still in its chunk file rather than in the tree. */
export function isUnloadedChunk(node: ApiSidebarNode): boolean {
  return !!node.chunk && (!node.items || node.items.length === 0);
}

/**
 * Keys of the root groups the generated tree marks pre-opened (`collapsed:
 * false`) — the Framework / Services groupings — so the sidebar opens them on
 * load. Root-only: deeper `collapsed` flags stay advisory.
 */
export function preOpenedRootKeys(nodes: readonly ApiSidebarNode[]): Set<string> {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (!isLeaf(node) && node.collapsed === false) {
      keys.add(groupKey('', node.text));
    }
  }
  return keys;
}

/**
 * Every group key in the tree. Used to prune the persisted disclosure store of
 * keys that no longer exist, so a renamed or removed module cannot keep a dead
 * entry alive or resurrect it if the name returns.
 */
export function groupKeys(nodes: readonly ApiSidebarNode[]): Set<string> {
  const keys = new Set<string>();
  const walk = (items: readonly ApiSidebarNode[], parentKey: string): void => {
    for (const node of items) {
      if (isLeaf(node)) continue;
      const key = groupKey(parentKey, node.text);
      keys.add(key);
      walk(node.items ?? [], key);
    }
  };
  walk(nodes, '');
  return keys;
}

/** Keys of every group in the tree, descending only into sections whose items are loaded. */
export function loadedGroupKeys(nodes: readonly ApiSidebarNode[]): Set<string> {
  const keys = new Set<string>();
  const walk = (items: readonly ApiSidebarNode[], parentKey: string): void => {
    for (const node of items) {
      if (isLeaf(node)) continue;
      const key = groupKey(parentKey, node.text);
      keys.add(key);
      if (!isUnloadedChunk(node)) walk(node.items ?? [], key);
    }
  };
  walk(nodes, '');
  return keys;
}

/** Keys a disclosure store may keep: every loaded group, plus stored keys under sections still unloaded. */
export function retainedGroupKeys(
  nodes: readonly ApiSidebarNode[],
  storedKeys: Iterable<string>,
): Set<string> {
  const keys = loadedGroupKeys(nodes);
  const unloaded: string[] = [];
  const walk = (items: readonly ApiSidebarNode[], parentKey: string): void => {
    for (const node of items) {
      if (isLeaf(node)) continue;
      const key = groupKey(parentKey, node.text);
      if (isUnloadedChunk(node)) unloaded.push(key + KEY_SEP);
      else walk(node.items ?? [], key);
    }
  };
  walk(nodes, '');
  for (const stored of storedKeys) {
    if (unloaded.some((prefix) => stored.startsWith(prefix))) keys.add(stored);
  }
  return keys;
}

/** The chunk owning a normalized page path (`<prefix><stem>.<Type>` or `<prefix><stem>-readme`); longest stem wins. */
export function chunkForPath(
  nodes: readonly ApiSidebarNode[],
  activePath: string,
  docsPrefix: string,
): string | undefined {
  let best: { chunk: string; length: number } | undefined;
  const visit = (items: readonly ApiSidebarNode[]): void => {
    for (const node of items) {
      if (node.chunk && node.modules) {
        for (const stem of node.modules) {
          const owns =
            activePath === `${docsPrefix}${stem}-readme` || activePath.startsWith(`${docsPrefix}${stem}.`);
          if (owns && (!best || stem.length > best.length)) {
            best = { chunk: node.chunk, length: stem.length };
          }
        }
      }
      if (node.items) visit(node.items);
    }
  };
  visit(nodes);
  return best?.chunk;
}

/** The tree with one section's items in place; untouched nodes keep their identity. */
export function withChunk(
  nodes: readonly ApiSidebarNode[],
  chunk: string,
  items: ApiSidebarNode[],
): ApiSidebarNode[] {
  return nodes.map((node) => {
    if (node.chunk === chunk) return { ...node, items };
    if (!node.items) return node;
    const next = withChunk(node.items, chunk, items);
    return next.some((n, i) => n !== node.items![i]) ? { ...node, items: next } : node;
  });
}

/** Names of every chunk the skeleton refers to, in tree order. */
export function chunkNames(nodes: readonly ApiSidebarNode[]): string[] {
  const names: string[] = [];
  const visit = (items: readonly ApiSidebarNode[]): void => {
    for (const node of items) {
      if (node.chunk) names.push(node.chunk);
      if (node.items) visit(node.items);
    }
  };
  visit(nodes);
  return names;
}

/** The chunk of the section whose group key is `key`, if that section is still unloaded. */
export function unloadedChunkForKey(nodes: readonly ApiSidebarNode[], key: string): string | undefined {
  let found: string | undefined;
  const walk = (items: readonly ApiSidebarNode[], parentKey: string): void => {
    for (const node of items) {
      if (isLeaf(node) || found) continue;
      const nodeKey = groupKey(parentKey, node.text);
      if (nodeKey === key) {
        if (isUnloadedChunk(node)) found = node.chunk;
        return;
      }
      walk(node.items ?? [], nodeKey);
    }
  };
  walk(nodes, '');
  return found;
}

/** Whether a leaf link is the active page. `activePath` must be normalized. */
export function isActiveLink(link: string | undefined, activePath: string, base = '/'): boolean {
  return !!link && normalizePath(link, base) === activePath;
}

/**
 * Keys of every group that (transitively) contains a leaf whose link matches
 * `activePath`, so the tree can auto-expand to reveal the current page.
 * `activePath` must already be normalized.
 */
export function activeAncestorKeys(
  nodes: readonly ApiSidebarNode[],
  activePath: string,
  base = '/',
): Set<string> {
  const keys = new Set<string>();
  const walk = (items: readonly ApiSidebarNode[], parentKey: string): boolean => {
    let hit = false;
    for (const node of items) {
      if (isLeaf(node)) {
        if (isActiveLink(node.link, activePath, base)) {
          hit = true;
        }
        continue;
      }
      const key = groupKey(parentKey, node.text);
      if (walk(node.items ?? [], key)) {
        keys.add(key);
        hit = true;
      }
    }
    return hit;
  };
  walk(nodes, '');
  return keys;
}

/**
 * Prune a sidebar tree down to entries matching every query term (AND), for the
 * in-sidebar symbol filter. A term is satisfied for a node when it matches the
 * node's own text or any ancestor's text — the tree spreads a symbol's qualified
 * name across levels (Service -> Resource -> Kind -> type), so "s3 bucket" keeps
 * `Bucket` under the S3 section while dropping `Topic` under SNS. A node whose
 * path satisfies all terms is kept with its whole subtree; otherwise a group is
 * kept only when a descendant path satisfies the remaining terms. Term order
 * never matters. Pure: never mutates the input; an empty result means "no
 * matches".
 */
export function filterSidebarTree(
  nodes: readonly ApiSidebarNode[],
  terms: readonly string[],
  termMatches: (text: string, term: string) => boolean,
): ApiSidebarNode[] {
  const out: ApiSidebarNode[] = [];
  for (const node of nodes) {
    // A friendly label (`Testing` for `aws-cdk-lib.assertions`) is matched as well as the module name it stands for.
    const remaining = terms.filter(
      (term) => !termMatches(node.text, term) && !(node.label !== undefined && termMatches(node.label, term)),
    );
    if (remaining.length === 0) {
      out.push(node);
      continue;
    }
    if (!isLeaf(node)) {
      const kept = filterSidebarTree(node.items ?? [], remaining, termMatches);
      if (kept.length > 0) {
        out.push({ ...node, items: kept });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Services view: one A to Z list of services derived from the generated tree
// ---------------------------------------------------------------------------

/** The generated tree's fixed Services section. */
const SERVICES_SECTION = 'Services';

/** The main library's module prefix in page ids, dropped from module row text. */
const CDK_LIB_PREFIX = 'aws-cdk-lib.';

/** The kind groups of an open service's `Types` part, in the order they are listed; any other kind follows them. */
export const SERVICE_KIND_ORDER: readonly string[] = ['Mixins', 'Facades', 'Traits', 'Events', 'Others'];

/** Case-insensitive A to Z, the order the generated Services section already uses. */
export function compareRowText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/** The page id of a generated link: its last path segment, less a readme's `-readme` suffix. */
export function pageId(link: string | undefined): string {
  const last = (link ?? '').replace(/\/+$/, '').split('/').pop() ?? '';
  return last.replace(/-readme$/, '');
}

/**
 * A module's display id, from its overview page id: `aws-cdk-lib.aws_s3_assets` is `aws_s3_assets`, and a scoped
 * package's flattened id (`@aws-cdk_aws-amplify-alpha`) is its package name (`@aws-cdk/aws-amplify-alpha`).
 */
export function moduleRowText(id: string): string {
  if (id.startsWith(CDK_LIB_PREFIX)) return id.slice(CDK_LIB_PREFIX.length);
  if (id.startsWith('@')) return id.replace('_', '/');
  return id;
}

/** The service nodes of the generated tree, A to Z; empty before the skeleton is loaded. */
export function serviceNodes(nodes: readonly ApiSidebarNode[]): ApiSidebarNode[] {
  const section = nodes.find((node) => node.section && node.text === SERVICES_SECTION);
  return [...(section?.items ?? [])].sort((a, b) => compareRowText(a.label ?? a.text, b.label ?? b.text));
}

/**
 * The service whose pages own a normalized page path (longest stem wins, as `chunkForPath`), or undefined when
 * the page is in no service: a framework page, a `constructs` page, or a page outside the generated docs.
 */
export function serviceForPath(
  nodes: readonly ApiSidebarNode[],
  activePath: string,
  docsPrefix: string,
): ApiSidebarNode | undefined {
  let best: { node: ApiSidebarNode; length: number } | undefined;
  for (const node of serviceNodes(nodes)) {
    for (const stem of node.modules ?? []) {
      const owns = activePath === `${docsPrefix}${stem}-readme` || activePath.startsWith(`${docsPrefix}${stem}.`);
      if (owns && (!best || stem.length > best.length)) best = { node, length: stem.length };
    }
  }
  return best?.node;
}

/**
 * Among a service's overview rows, the one of its main module: the `aws-cdk-lib` module with the shortest page id
 * (`aws-cdk-lib.aws_s3` for S3), else the first overview row. Undefined for a service with no overview page.
 */
function mainOverview(overviews: readonly ApiSidebarNode[]): ApiSidebarNode | undefined {
  let main: ApiSidebarNode | undefined;
  for (const row of overviews) {
    const id = pageId(row.link);
    if (!id.startsWith(CDK_LIB_PREFIX)) continue;
    if (!main || id.length < pageId(main.link).length) main = row;
  }
  return main ?? overviews[0];
}

/**
 * The rows of one open service, as the Services view lists them. In order, each part only when it has rows:
 * `Overview` (the main module's overview page), `Modules` (the other overview pages, named by module id with
 * the generated per-language labels, each counting the type rows of its module), `Constructs` (every construct,
 * flat, in the order of the generated service tree) and `Types` (one closed kind group per kind the service
 * has, merged across its resources, rows A to Z by display label; two nested types that share a short label show
 * their owner-qualified text). A kind group's `Type index` row (a kind-less leaf docgen adds
 * for types without a page of their own) is listed after the sorted type rows and left out of the type and
 * construct counts; while filtering, a service's count is its visible rows, this one included. With `flat` set
 * (the filter is active) the same rows come back as one flat list without parts or kind groups: overview,
 * modules, constructs, then the types kind by kind, so the filter prunes rows rather than groups.
 */
export function serviceViewItems(items: readonly ApiSidebarNode[], flat = false): ApiSidebarNode[] {
  // A short label names a nested type only under its owner's resource group, which a merged kind group has no
  // more; rows that share one show their owner-qualified text instead, so two `BlockDeviceMappingProperty`
  // rows read `CfnLaunchTemplate.BlockDeviceMappingProperty` and `CfnSpotFleet.BlockDeviceMappingProperty`.
  const qualifyCollisions = (group: readonly ApiSidebarNode[]): ApiSidebarNode[] => {
    const uses = new Map<string, number>();
    for (const row of group) if (row.label !== undefined) uses.set(row.label, (uses.get(row.label) ?? 0) + 1);
    return group.map((row) => {
      if (row.label === undefined || uses.get(row.label)! < 2) return row;
      const { label: _label, ...qualified } = row;
      return qualified;
    });
  };
  const rows = serviceRows(items);
  const main = mainOverview(rows.overviews);
  const overview: ApiSidebarNode[] = main ? [{ text: 'Overview', link: main.link }] : [];
  // A type row has a `kind`; a kind group's `Type index` leaf has none and is listed, not counted.
  const isTypeRow = (row: ApiSidebarNode): boolean => row.kind !== undefined;
  // Every type row of the service, for the per-module counts.
  const typeIds = [...rows.constructs, ...[...rows.kinds.values()].flat()]
    .filter(isTypeRow)
    .map((row) => pageId(row.link));
  const modules: ApiSidebarNode[] = rows.overviews
    .filter((row) => row !== main)
    .map((row) => {
      const id = pageId(row.link);
      // The per-language labels stay with the row, so the Services view and the API view name a module the same
      // way in every language.
      return {
        text: moduleRowText(id),
        ...(row.labels ? { labels: row.labels } : {}),
        link: row.link,
        moduleRow: true,
        count: typeIds.filter((typeId) => typeId.startsWith(`${id}.`)).length,
      };
    });
  // The known kinds in their fixed order, then any kind group the generator adds later, in tree order, so no
  // row is ever dropped.
  const kindNames = [
    ...SERVICE_KIND_ORDER.filter((kind) => rows.kinds.has(kind)),
    ...[...rows.kinds.keys()].filter((kind) => !SERVICE_KIND_ORDER.includes(kind)),
  ];
  const kinds: ApiSidebarNode[] = kindNames.map((kind) => {
    const all = qualifyCollisions(rows.kinds.get(kind)!);
    const typed = all.filter(isTypeRow).sort((a, b) => compareRowText(a.label ?? a.text, b.label ?? b.text));
    const leaves = [...typed, ...all.filter((row) => !isTypeRow(row))];
    return { text: kind, kindGroup: true, collapsed: true, count: typed.length, items: leaves };
  });
  if (flat) return [...overview, ...modules, ...rows.constructs, ...kinds.flatMap((kind) => kind.items ?? [])];
  const parts: ApiSidebarNode[] = [];
  if (modules.length > 0) parts.push({ text: 'Modules', part: true, items: modules });
  if (rows.constructs.length > 0) {
    parts.push({ text: 'Constructs', part: true, count: rows.constructs.length, items: [...rows.constructs] });
  }
  if (kinds.length > 0) {
    const count = kinds.reduce((sum, kind) => sum + (kind.count ?? 0), 0);
    parts.push({ text: 'Types', part: true, count, items: kinds });
  }
  return [...overview, ...parts];
}

/**
 * The Services view's tree: the generated Services section's nodes, A to Z, each loaded one carrying the rows of
 * `serviceViewItems` and each unloaded one kept as the skeleton node (its `chunk` names the file to fetch, its
 * `count` is docgen's construct count). The service nodes are the roots, so a service's group key is its text and
 * the keys of its parts and their kind groups nest under it (`S3` › `Types` › `Others`), apart from the API view's
 * keys under `Services`.
 */
export function servicesViewTree(nodes: readonly ApiSidebarNode[], flat = false): ApiSidebarNode[] {
  return serviceNodes(nodes).map((service) => (isUnloadedChunk(service) ? service : serviceViewNode(service, flat)));
}

// The derived rows of a loaded service, by the service node. `withChunk` keeps every untouched node's identity,
// so when one more chunk lands only that service is rebuilt; the filter streams hundreds of chunks in at once.
const serviceViewNodes = new WeakMap<ApiSidebarNode, { parts?: ApiSidebarNode; flat?: ApiSidebarNode }>();

function serviceViewNode(service: ApiSidebarNode, flat: boolean): ApiSidebarNode {
  let cached = serviceViewNodes.get(service);
  if (!cached) {
    cached = {};
    serviceViewNodes.set(service, cached);
  }
  const key = flat ? 'flat' : 'parts';
  cached[key] ??= { ...service, items: serviceViewItems(service.items ?? [], flat) };
  return cached[key];
}

// ---------------------------------------------------------------------------
// Fetch memoization (client-only; never invoked from tests)
// ---------------------------------------------------------------------------

const sidebarCache = new Map<string, Promise<ApiSidebarNode[]>>();

/** Fetch a sidebar asset (skeleton or chunk), memoized by `key`; a failed fetch is evicted so it can retry. */
export function loadApiSidebar(url: string, key: string): Promise<ApiSidebarNode[]> {
  let promise = sidebarCache.get(key);
  if (!promise) {
    promise = fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`api sidebar fetch failed: ${res.status}`);
        }
        return res.json() as Promise<ApiSidebarNode[]>;
      })
      .catch((err) => {
        sidebarCache.delete(key);
        throw err;
      });
    sidebarCache.set(key, promise);
  }
  return promise;
}
