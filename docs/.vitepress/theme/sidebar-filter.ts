/**
 * Shared reactive state between the navbar symbol filter input (NavFilter.vue)
 * and the lazy-loaded API sidebar (ApiSidebar.vue): typing in the filter narrows
 * the sidebar tree in place instead of opening a popup. A module-level ref is
 * enough — both components live in the same client app and there is one input.
 */
import { ref } from 'vue';

/** The current filter query; blank means "not filtering". */
export const sidebarFilterQuery = ref('');

/** Shortest query that filters. One character matches too much to be useful. */
export const MIN_FILTER_QUERY_LENGTH = 2;

/**
 * Whether a query is long enough to act on. The single definition of that: a
 * shorter query must behave exactly like an empty one everywhere — no narrowing,
 * no Enter target, no hint — so the publisher, the ranker and the template all
 * ask this rather than each testing a length.
 */
export function isFilterActive(query: string): boolean {
  return query.trim().length >= MIN_FILTER_QUERY_LENGTH;
}

/**
 * Folds made while the filter is active. A surviving group starts open so its
 * matches are reachable; a key in this set is a group the reader folded during
 * the current filter session. The set is separate from the reader's saved
 * expansion state on purpose: it lives only while the filter is active (the
 * sidebar empties it when the filter ends or the navigation style switches) and
 * is never written to storage, so clearing the filter restores the exact
 * pre-filter tree. Returns a new set so a Vue ref holding it sees the change.
 */
export function toggleFilterCollapsed(collapsed: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Whether a group shows its children while filtering: open unless folded this session. */
export function isOpenWhileFiltering(collapsed: ReadonlySet<string>, key: string): boolean {
  return !collapsed.has(key);
}
