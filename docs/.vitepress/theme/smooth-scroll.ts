/**
 * Shared scroll animation for the sidebar's "Locate current page" reveal and the
 * floating "back to top" control. Framework-free (no Vue, no DOM queries at
 * import time) so the maths is unit-testable in plain Node.
 *
 * Hand-rolled rather than `scrollTo({ behavior: "smooth" })`: native smooth
 * scrolling exposes no duration knob and (in Blink) scales duration with
 * distance, so a jump across the full API index falls outside the responsive
 * band. A requestAnimationFrame loop pins the duration regardless of distance.
 */

/** One duration for every scroll-motion affordance in the theme. */
export const SCROLL_DURATION_MS = 300;

// Browser globals typed structurally so this module also compiles (and
// unit-tests) under the node tsconfig, which loads no DOM lib.
const g = globalThis as {
  matchMedia?: (query: string) => { matches: boolean };
  requestAnimationFrame?: (cb: (now: number) => void) => number;
};

/**
 * Ease-out cubic: fast start, gentle settle. A navigation aid should read as
 * immediate, so most of the distance is covered in the first half.
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** The one place the reduced-motion preference is read. */
export function prefersReducedMotion(): boolean {
  return g.matchMedia !== undefined
    && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animate `el.scrollTop` to `top` over `durationMs`, or set it immediately when
 * the user prefers reduced motion (WCAG 2.3.3) — reduced motion still moves, it
 * just does not animate.
 *
 * `el` is anything with a settable `scrollTop`: the sidebar's inner scroller, or
 * `document.documentElement` for the window.
 */
export function animateScrollTop(
  el: { scrollTop: number },
  top: number,
  durationMs: number = SCROLL_DURATION_MS,
): void {
  const from = el.scrollTop;
  const delta = top - from;
  if (delta === 0) return;
  const raf = g.requestAnimationFrame;
  if (prefersReducedMotion() || durationMs <= 0 || raf === undefined) {
    el.scrollTop = top;
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min((now - start) / durationMs, 1);
    el.scrollTop = from + delta * easeOutCubic(t);
    if (t < 1) raf(step);
  };
  raf(step);
}
