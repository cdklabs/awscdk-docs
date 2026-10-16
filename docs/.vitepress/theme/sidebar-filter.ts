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
