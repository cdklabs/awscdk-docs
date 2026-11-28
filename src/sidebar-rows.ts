/**
 * The rows of one service in the generated API sidebar, read the way the Explorer's Services view lists them.
 *
 * A service's chunk (`docs/public/api-sidebar/chunks/<service>`) is the generated tree for that service: its overview
 * pages first, then one group per resource (a leaf per construct, plus kind groups for the supporting types) or,
 * for a service with a single resource, the constructs and kind groups directly. This module flattens that tree
 * into three lists under one rule, shared by docgen (which writes each service's construct count into the served
 * skeleton, so a closed row shows it without loading the chunk) and the client (which lists the same rows once the
 * service is open), so the count on a closed row always equals the rows under `Constructs` once it is open.
 *
 * Framework-free and dependency-free: docgen runs it in Node, the theme in the browser, and the tests in plain Node.
 */

/** The structural shape both `SidebarItem` (docgen) and `ApiSidebarNode` (theme) satisfy. */
export interface SidebarRowNode {
  readonly text: string;
  readonly link?: string;
  /** Stable kind of a type leaf. Absent on an overview (readme) leaf, which is how the two are told apart. */
  readonly kind?: string;
  readonly kindGroup?: boolean;
  readonly chunk?: string;
  readonly items?: readonly SidebarRowNode[];
}

export interface ServiceRows<T extends SidebarRowNode> {
  /** Overview pages: the leaves at the service's top level that are readmes (no `kind`). In tree order. */
  readonly overviews: T[];
  /** Construct rows: every leaf outside a kind group that is not an overview, resource by resource in tree order. */
  readonly constructs: T[];
  /**
   * Supporting types by kind group name (`Mixins`, `Others`, ...), merged across the service's resources. A kind
   * group's leaves include docgen's kind-less `Type index` row for types without a page of their own; callers
   * that count types tell it apart by its missing `kind`.
   */
  readonly kinds: Map<string, T[]>;
}

/** The kind group docgen gives constructs in a flat section; its leaves are construct rows, not supporting types. */
const CONSTRUCTS_KIND = 'Constructs';

/** Whether a leaf is an overview (readme) page rather than a type page: type leaves carry a `kind`, readmes do not. */
export function isOverviewRow(node: SidebarRowNode): boolean {
  return node.kind === undefined;
}

function isLeaf(node: SidebarRowNode): boolean {
  return !node.chunk && (!node.items || node.items.length === 0);
}

/** Every leaf under a node, in tree order. */
function leaves<T extends SidebarRowNode>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (const node of items) {
    if (isLeaf(node)) out.push(node);
    else out.push(...leaves((node.items ?? []) as readonly T[]));
  }
  return out;
}

/**
 * Classify one service's loaded items into overview, construct and kind-group rows. A leaf at the top level is an
 * overview when it has no `kind` (a readme), else a construct; a kind group's leaves are supporting types of that kind,
 * except the `Constructs` kind group, whose leaves are constructs; any other group (a resource, `General`) is
 * walked with the same rule, its leaves being constructs.
 */
export function serviceRows<T extends SidebarRowNode>(items: readonly T[]): ServiceRows<T> {
  const rows: ServiceRows<T> = { overviews: [], constructs: [], kinds: new Map() };
  const walk = (nodes: readonly T[], top: boolean): void => {
    for (const node of nodes) {
      if (isLeaf(node)) {
        if (top && isOverviewRow(node)) rows.overviews.push(node);
        else rows.constructs.push(node);
        continue;
      }
      const children = (node.items ?? []) as readonly T[];
      if (!node.kindGroup) {
        walk(children, false);
        continue;
      }
      const kindLeaves = leaves(children);
      if (node.text === CONSTRUCTS_KIND) {
        rows.constructs.push(...kindLeaves);
        continue;
      }
      const list = rows.kinds.get(node.text);
      if (list) list.push(...kindLeaves);
      else rows.kinds.set(node.text, [...kindLeaves]);
    }
  };
  walk(items, true);
  return rows;
}

/** The number of construct rows of a service: what the Services view shows on a closed service row. */
export function constructCount(items: readonly SidebarRowNode[]): number {
  return serviceRows(items).constructs.length;
}
