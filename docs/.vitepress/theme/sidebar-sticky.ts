/**
 * Sticky group headings in the API sidebar.
 *
 * Every eligible group heading (a collapsible group that is not a kind group)
 * is `position: sticky` in CSS, pinned at `--api-sidebar-sticky-top`, the
 * measured height of the pinned `.sidebar-header` block. Its containing block
 * is the group's own `<li>`, so the browser pushes it up as the group ends and
 * the next heading takes over, with no script involved.
 *
 * Two things CSS cannot do are done here, from observer callbacks only (no
 * scroll listener, no per-frame layout reads):
 *
 * - Keep `--api-sidebar-sticky-top` equal to the header's height, which
 *   changes when Favorites expands or collapses.
 * - Show only the DEEPEST pinned heading. Nested headings stick at the same
 *   offset and a deeper one paints above its ancestors, but an ancestor whose
 *   name wraps to more lines would still show below it, so the ancestors of
 *   the pinned heading are marked `data-sticky-covered` and hidden.
 *
 * A group counts as pinned when its `<li>` crosses the line under the header
 * AND its heading is still entirely below that line. The second half matters
 * at a group's end: once the heading starts being pushed up, the group no
 * longer counts as pinned, so its ancestor shows again behind it instead of a
 * gap opening up while it slides away.
 */

/** Attribute on the `<li>` of the heading shown in the pinned band. */
export const PINNED_ATTR = 'data-sticky-pinned';
/** Attribute on the `<li>` of an ancestor hidden behind the pinned heading. */
export const COVERED_ATTR = 'data-sticky-covered';
/** CSS custom property, set on the scroll container, that headings pin at. */
export const STICKY_TOP_VAR = '--api-sidebar-sticky-top';

/**
 * IntersectionObserver root margins for a scroll container whose pinned
 * header ends `lineOffset` px below the root's top edge.
 *
 * `line` shrinks the root to the 1px line just below the header: a group's
 * `<li>` intersects it exactly while the group spans the pinned band.
 * `belowLine` shrinks the root to everything under the header, with 1px of
 * slack so a heading pinned at a fractional offset still reads as fully in.
 */
export function stickyRootMargins(
  lineOffset: number,
  clientHeight: number,
): { line: string; belowLine: string } {
  const top = Math.max(0, Math.round(lineOffset));
  const bottom = Math.max(0, Math.round(clientHeight) - top - 1);
  return {
    line: `-${top}px 0px -${bottom}px 0px`,
    belowLine: `-${Math.max(0, top - 1)}px 0px 0px 0px`,
  };
}

/**
 * The pinned group, if any: of the groups that span the band with their
 * heading fully shown, the one no other such group is nested in. Groups that
 * span the band are always one ancestor chain, so "contains no other" is
 * "deepest". Also returns that group's ancestors in `spanning`, which its
 * heading covers.
 */
export function resolvePinned<T>(
  spanning: readonly T[],
  fullyShown: ReadonlySet<T>,
  contains: (outer: T, inner: T) => boolean,
): { pinned: T | undefined; covered: T[] } {
  const candidates = spanning.filter((el) => fullyShown.has(el));
  const pinned = candidates.find(
    (el) => !candidates.some((other) => other !== el && contains(el, other)),
  );
  if (pinned === undefined) return { pinned: undefined, covered: [] };
  const covered = spanning.filter((el) => el !== pinned && contains(el, pinned));
  return { pinned, covered };
}

/**
 * How far to scroll after a pinned group collapses so its heading row lands
 * directly below the header. Positive scrolls the tree up toward the top.
 * Called with the collapsed `<li>`'s top edge, which is now its heading row.
 */
export function collapseScrollDelta(groupTop: number, headerBottom: number): number {
  return groupTop - headerBottom;
}

/** Whether a sticky heading is currently stuck, i.e. displaced from its natural top. */
export function isStuck(headingTop: number, groupTop: number): boolean {
  return headingTop - groupTop > 0.5;
}

/**
 * Tracks the eligible group `<li>`s of one sidebar and keeps the pinned band
 * consistent. Items register on mount and unregister on unmount; the tree is
 * lazily rendered, so only groups on screen in the DOM are ever observed.
 */
export class StickyHeadings {
  private readonly groups = new Set<HTMLElement>();
  private container: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private lineObserver: IntersectionObserver | null = null;
  private headingObserver: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly spanning = new Set<HTMLElement>();
  private readonly fullyShown = new Set<HTMLElement>();
  private pinned: HTMLElement | undefined;
  private covered: HTMLElement[] = [];
  private headerHeight = 0;

  /** Height of the heading in the pinned band, 0 when none is pinned. */
  pinnedHeight(): number {
    return this.pinned ? headingOf(this.pinned)?.getBoundingClientRect().height ?? 0 : 0;
  }

  /** Measured height of the pinned header block. */
  headerOffset(): number {
    return this.headerHeight;
  }

  register(group: HTMLElement): void {
    this.groups.add(group);
    this.observe(group);
  }

  unregister(group: HTMLElement): void {
    this.groups.delete(group);
    this.lineObserver?.unobserve(group);
    const heading = headingOf(group);
    if (heading) this.headingObserver?.unobserve(heading);
    this.spanning.delete(group);
    if (heading) this.fullyShown.delete(heading as HTMLElement);
    group.removeAttribute(PINNED_ATTR);
    group.removeAttribute(COVERED_ATTR);
    if (this.pinned === group || this.covered.includes(group)) this.update();
  }

  /** (Re)bind to a scroll container; a no-op when it is already bound. */
  attach(container: HTMLElement): void {
    if (container === this.container) return;
    this.detach();
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') return;
    this.container = container;
    this.header = container.querySelector<HTMLElement>('.sidebar-header');
    // Both the header (Favorites toggling) and the container (viewport or
    // drawer resize) move the line the observers are cut to.
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(container);
    if (this.header) this.resizeObserver.observe(this.header);
    this.measure();
  }

  detach(): void {
    this.lineObserver?.disconnect();
    this.headingObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.lineObserver = null;
    this.headingObserver = null;
    this.resizeObserver = null;
    this.container?.style.removeProperty(STICKY_TOP_VAR);
    this.container = null;
    this.header = null;
    this.spanning.clear();
    this.fullyShown.clear();
    this.apply(undefined, []);
  }

  /** Runs inside the ResizeObserver callback (and once on attach). */
  private measure(): void {
    const container = this.container;
    if (!container) return;
    const headerBox = this.header?.getBoundingClientRect();
    this.headerHeight = headerBox?.height ?? 0;
    container.style.setProperty(STICKY_TOP_VAR, `${this.headerHeight}px`);
    // The observers' root is the container's padding box; the header is
    // pinned at the content edge, so measure the line from where it really is.
    const rootTop = container.getBoundingClientRect().top + container.clientTop;
    const lineOffset = headerBox ? headerBox.bottom - rootTop : 0;
    const margins = stickyRootMargins(lineOffset, container.clientHeight);
    this.lineObserver?.disconnect();
    this.headingObserver?.disconnect();
    this.spanning.clear();
    this.fullyShown.clear();
    this.lineObserver = new IntersectionObserver((entries) => this.onLine(entries), {
      root: container,
      rootMargin: margins.line,
    });
    this.headingObserver = new IntersectionObserver((entries) => this.onHeading(entries), {
      root: container,
      rootMargin: margins.belowLine,
      threshold: [1],
    });
    for (const group of this.groups) this.observe(group);
  }

  private observe(group: HTMLElement): void {
    const heading = headingOf(group);
    if (!this.lineObserver || !this.headingObserver || !heading) return;
    this.lineObserver.observe(group);
    this.headingObserver.observe(heading);
  }

  private onLine(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const group = entry.target as HTMLElement;
      if (entry.isIntersecting) this.spanning.add(group);
      else this.spanning.delete(group);
    }
    this.update();
  }

  private onHeading(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const heading = entry.target as HTMLElement;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.999) this.fullyShown.add(heading);
      else this.fullyShown.delete(heading);
    }
    this.update();
  }

  private update(): void {
    const spanning = [...this.spanning].filter((group) => this.groups.has(group));
    const shown = new Set(
      spanning.filter((group) => {
        const heading = headingOf(group);
        return heading !== null && this.fullyShown.has(heading as HTMLElement);
      }),
    );
    const { pinned, covered } = resolvePinned(spanning, shown, (outer, inner) =>
      outer.contains(inner),
    );
    this.apply(pinned, covered);
  }

  private apply(pinned: HTMLElement | undefined, covered: HTMLElement[]): void {
    if (this.pinned && this.pinned !== pinned) this.pinned.removeAttribute(PINNED_ATTR);
    for (const el of this.covered) if (!covered.includes(el)) el.removeAttribute(COVERED_ATTR);
    pinned?.setAttribute(PINNED_ATTR, '');
    for (const el of covered) el.setAttribute(COVERED_ATTR, '');
    this.pinned = pinned;
    this.covered = covered;
    // Keyboard focus scrolling must clear the pinned heading as well as the
    // header block, so a focused row never lands behind it.
    if (this.container) {
      this.container.style.scrollPaddingTop = `${this.headerHeight + this.pinnedHeight()}px`;
    }
  }
}

/** The group's own heading button. */
export function headingOf(group: Element): HTMLElement | null {
  const first = group.firstElementChild;
  return first instanceof HTMLElement && first.classList.contains('api-sidebar-group') ? first : null;
}

/**
 * Height of the heading that will be pinned over `entry` once it is in view:
 * that of its nearest enclosing eligible group, or 0 when it has none.
 */
export function enclosingStickyHeight(entry: Element): number {
  let li = entry.closest('li.api-sidebar-item')?.parentElement?.closest('li.api-sidebar-item');
  while (li) {
    if (!li.hasAttribute('data-kind-group')) {
      const heading = headingOf(li);
      if (heading) return heading.getBoundingClientRect().height;
    }
    li = li.parentElement?.closest('li.api-sidebar-item') ?? null;
  }
  return 0;
}
