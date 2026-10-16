import type { ConstructLevel } from './constructs.js';

/**
 * Construct levels in reading order: the highest-level, most opinionated
 * construct first and the raw CloudFormation resource last, because that
 * is the order a reader wants to meet them in — an L3 pattern is the
 * answer for most callers, an L1 is the escape hatch.
 */
const LEVEL_RANK: Record<ConstructLevel, number> = { L3: 0, L2: 1, L1: 2 };

/**
 * Rank of anything not leveled. Everything that is not a construct
 * (interfaces, structs, enums, mixins, facades, traits) and every
 * construct the heuristics could not place (`constructs.Construct`
 * itself, for one) shares this rank, keeping those lists alphabetical.
 */
const UNLEVELED_RANK = 3;

const rank = (level?: ConstructLevel): number => (level ? LEVEL_RANK[level] : UNLEVELED_RANK);

/**
 * Sort by construct level (L3, L2, L1, then unleveled), alphabetically
 * within each tier. Shared by the two places that order type lists — the
 * sidebar's leaf lists and the type tables on index/overview pages — so
 * the nav and the page tables cannot drift apart.
 *
 * The level is taken from the field the caller already carries
 * (`SidebarEntry.level` / `TypeEntry.level`, both from
 * {@link constructLevel}); nothing is re-classified here.
 */
export function byLevelThenName<T extends { readonly name: string; readonly level?: ConstructLevel }>(
  a: T,
  b: T,
): number {
  return rank(a.level) - rank(b.level) || a.name.localeCompare(b.name);
}
