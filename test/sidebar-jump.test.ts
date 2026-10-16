/**
 * "Locate current page" sidebar control: reveals the active entry or flashes it when already visible.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { jumpToCurrentRequest, requestJumpToCurrent } from '../docs/.vitepress/theme/sidebar-jump.js';

const themeDir = join(import.meta.dirname, '..', 'docs', '.vitepress', 'theme');
const component = readFileSync(join(themeDir, 'JumpToCurrent.vue'), 'utf-8');
const sidebar = readFileSync(join(themeDir, 'ApiSidebar.vue'), 'utf-8');
const entry = readFileSync(join(themeDir, 'index.ts'), 'utf-8');

describe('sidebar-jump shared signal', () => {
  test('each activation bumps the counter so repeat clicks re-trigger', () => {
    const before = jumpToCurrentRequest.value;
    requestJumpToCurrent();
    requestJumpToCurrent();
    expect(jumpToCurrentRequest.value).toBe(before + 2);
  });
});

describe('JumpToCurrent control', () => {
  test('renders in the filter status row inside the sidebar-nav-before slot', () => {
    const mount = /"sidebar-nav-before":\s*\(\)\s*=>\s*([\s\S]*?)\n      "doc-before"/.exec(entry);
    expect(mount).not.toBeNull();
    const slot = mount![1];
    expect(slot).toContain('class: "sidebar-header"');
    const filterMount = /h\(\s*NavFilter\s*,[\s\S]*?\}\s*\)/.exec(slot);
    expect(filterMount).not.toBeNull();
    expect(filterMount![0]).toContain('status-actions');
    expect(filterMount![0]).toMatch(/h\(\s*JumpToCurrent\s*\)/);
    expect(slot.indexOf('h(NavFilter')).toBeLessThan(slot.indexOf('h(FavoritesList)'));
  });

  test('is a real button whose accessible name is its visible label (WCAG 2.5.3)', () => {
    expect(component).toContain('type="button"');
    // No aria-label override: the visible text IS the accessible name, so
    // speech-input users can activate it by saying what they see.
    expect(component).not.toContain('aria-label=');
    expect(component).toContain('>Locate current page</span>');
  });

  test('only renders on API pages and publishes through the shared signal', () => {
    // Inert outside /api/ like the API sidebar itself.
    expect(component).toContain('activePath.value.startsWith(API_ROOT.replace(/^\\//, ""))');
    expect(component).toContain('requestJumpToCurrent()');
  });
});

describe('ApiSidebar jump handling', () => {
  test('watches the shared request signal', () => {
    expect(sidebar).toContain('import { jumpToCurrentRequest } from "./sidebar-jump"');
    expect(sidebar).toContain('watch(jumpToCurrentRequest,');
  });

  test('unfolds ancestors, scrolls the active entry into view, and moves focus', () => {
    // The watcher reuses the existing expansion/scroll machinery: syncActive
    // (ancestor keys only ever ADDED to the user's open set) + the same
    // centered scroll used for deep-link reveal, then focuses the link so
    // keyboard users land on the revealed entry (without double-scrolling).
    const watcher = sidebar.slice(sidebar.indexOf('watch(jumpToCurrentRequest,'));
    expect(watcher).toContain('syncActive()');
    expect(watcher).toContain('scrollActiveIntoView(container)');
    expect(watcher).toContain('active.focus({ preventScroll: true })');
  });

  test('the reveal is duration-pinned, not delegated to native smooth scroll', () => {
    // behavior: "smooth" hands the animation to the UA's scroll animator,
    // whose duration scales with distance — a jump across the full API
    // index landed far outside the ~300ms budget. The shared helper pins
    // the duration; the reveal keeps its target computation and early
    // returns and changes only the movement mechanism.
    expect(sidebar).toContain('import { animateScrollTop } from "./smooth-scroll"');
    expect(sidebar).toContain('animateScrollTop(container, target)');
    expect(sidebar).not.toContain('behavior: "smooth"');
  });
});

describe('BackToTop control', () => {
  const backToTop = readFileSync(join(themeDir, 'BackToTop.vue'), 'utf-8');

  test('mounts in the layout-bottom slot beside the footer', () => {
    expect(entry).toContain('"layout-bottom": () => [h(SiteFooter), h(BackToTop)]');
  });

  test('drives the WINDOW scroller through the same shared helper', () => {
    // One tested animation helper for both scroll-motion affordances —
    // and the window, not the sidebar container, so per-route sidebar
    // scroll memory is untouched.
    expect(backToTop).toContain('import { animateScrollTop } from "./smooth-scroll"');
    expect(backToTop).toContain('animateScrollTop(document.documentElement, 0)');
    expect(backToTop).not.toContain('behavior: "smooth"');
  });

  test('is a real button named by text, not an aria-label (WCAG 2.5.3)', () => {
    expect(backToTop).toContain('type="button"');
    expect(backToTop).not.toContain('aria-label=');
    expect(backToTop).toContain('>Back to top</span>');
  });

  test('activation hands focus to the document top before the control hides itself', () => {
    // display:none on a still-focused button throws focus to <body>; the
    // handoff mirrors the sidebar reveal's focus({ preventScroll: true }).
    expect(backToTop).toContain('focus({ preventScroll: true })');
  });

  test('visibility listener is passive and rAF-throttled', () => {
    expect(backToTop).toContain('{ passive: true }');
    expect(backToTop).toContain('requestAnimationFrame');
  });
});
