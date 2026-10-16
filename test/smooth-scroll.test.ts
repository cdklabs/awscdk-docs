/**
 * Shared scroll animation helper: the maths and the motion
 * policy, unit-tested in plain Node. The browser half — real timing on
 * the rendered site — lives in test/e2e/back-to-top.spec.ts and the
 * timing assertion in test/e2e/sidebar-jump.spec.ts.
 */
import {
  SCROLL_DURATION_MS,
  animateScrollTop,
  easeOutCubic,
} from '../docs/.vitepress/theme/smooth-scroll.js';

describe('easeOutCubic', () => {
  test('hits both endpoints exactly', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  test('is monotonic and front-loaded (a navigation aid reads as immediate)', () => {
    let prev = 0;
    for (let i = 1; i <= 10; i++) {
      const v = easeOutCubic(i / 10);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    // More than half the distance is covered in the first half of the time.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('animateScrollTop', () => {
  test('every animated scroll shares one 300ms duration', () => {
    expect(SCROLL_DURATION_MS).toBe(300);
  });

  test('no-ops when already at the target', () => {
    const el = { scrollTop: 120 };
    animateScrollTop(el, 120);
    expect(el.scrollTop).toBe(120);
  });

  test('sets immediately when no animation frame source exists (reduced-motion path shape)', () => {
    // Node has no requestAnimationFrame, which exercises the same
    // immediate-set branch prefers-reduced-motion takes in a browser:
    // the element still MOVES (WCAG 2.3.3 wants no animation, not no
    // scrolling).
    expect(typeof (globalThis as Record<string, unknown>).requestAnimationFrame).toBe('undefined');
    const el = { scrollTop: 500 };
    animateScrollTop(el, 0);
    expect(el.scrollTop).toBe(0);
  });

  test('reduced motion sets immediately even when a frame source exists', () => {
    // The branch above cannot distinguish the PREFERENCE from the missing
    // frame source, so this is the test that pins the policy itself: with
    // requestAnimationFrame present and matchMedia reporting reduce, the
    // set must be synchronous and no frame may be queued. Deleting the
    // prefersReducedMotion() guard from animateScrollTop fails exactly
    // this test.
    const globals = globalThis as Record<string, unknown>;
    let framesQueued = 0;
    globals.requestAnimationFrame = () => {
      framesQueued += 1;
      return framesQueued;
    };
    globals.matchMedia = () => ({ matches: true });
    try {
      const el = { scrollTop: 800 };
      animateScrollTop(el, 0);
      expect(el.scrollTop).toBe(0);
      expect(framesQueued).toBe(0);
    } finally {
      delete globals.requestAnimationFrame;
      delete globals.matchMedia;
    }
  });

  test('animates through intermediate positions and lands exactly on target', () => {
    // Deterministic frame source: each frame advances a fake clock by
    // 100ms, so a 300ms animation takes exactly 3 frames after start.
    let now = 0;
    type Frame = (now: number) => void;
    const frames: Frame[] = [];
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: Frame) => {
      frames.push(cb);
      return frames.length;
    };
    const realNow = performance.now.bind(performance);
    performance.now = () => now;
    try {
      const el = { scrollTop: 900 };
      animateScrollTop(el, 0);
      const positions: number[] = [];
      while (frames.length > 0) {
        now += 100;
        frames.shift()!(now);
        positions.push(el.scrollTop);
      }
      // Strictly decreasing towards the target, and the last frame lands
      // exactly on it — no residue from floating-point easing.
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeLessThan(positions[i - 1]);
      }
      expect(positions.length).toBe(3);
      expect(el.scrollTop).toBe(0);
    } finally {
      performance.now = realNow;
      delete (globalThis as Record<string, unknown>).requestAnimationFrame;
    }
  });
});
