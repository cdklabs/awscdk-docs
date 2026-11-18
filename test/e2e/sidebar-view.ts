// Shared helpers for specs that check which sidebar headings the reader can see.
import { expect, type Page } from '@playwright/test';

/** Resolves once the sidebar has stopped scrolling, so the load-time reveal is done. */
export async function scrollSettled(page: Page) {
  const top = () => page.evaluate(() => document.querySelector('.VPSidebar')?.scrollTop ?? 0);
  let last = -1;
  await expect.poll(async () => {
    const now = await top();
    const still = now === last;
    last = now;
    return still;
  }, { intervals: [150] }).toBe(true);
}

export interface ClosedHeading {
  text: string;
  /** `seen`: the heading's center is painted on top; `hidden`: no part of it is; `partly`: neither. */
  view: 'seen' | 'hidden' | 'partly';
}

/**
 * Every closed group heading, classed by hit-testing painted points rather than by box math, so a
 * heading under the sticky header or outside the scroller counts as hidden.
 */
export async function closedHeadings(page: Page): Promise<ClosedHeading[]> {
  await expect(page.locator('.VPSidebar .sidebar-header')).toHaveCount(1);
  return page.evaluate(() => {
    const painted = (button: HTMLElement, y: number, x: number) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && button.contains(hit);
    };
    return Array.from(document.querySelectorAll<HTMLElement>('.api-sidebar-group[aria-expanded="false"]')).map((button) => {
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const center = painted(button, box.top + box.height / 2, x);
      const any = center || painted(button, box.top + 1, x) || painted(button, box.bottom - 1, x);
      const view: 'seen' | 'hidden' | 'partly' = center ? 'seen' : any ? 'partly' : 'hidden';
      return { text: button.querySelector('.api-sidebar-text')?.textContent ?? '', view };
    });
  });
}

/** The sidebar's top-level entries (`API Reference`, packages, or the Framework/Services sections). */
export const topLevel = (page: Page) => page.locator('.api-sidebar-nav > .api-sidebar-list > li');

/** The top-level entry whose group button reads `name`. */
export const topGroup = (page: Page, name: string) =>
  topLevel(page).filter({ has: page.locator(`:scope > button.api-sidebar-group:has-text("${name}")`) }).first();

/** The group button of the top-level entry named `name`. */
export const topButton = (page: Page, name: string) => topGroup(page, name).locator(':scope > button.api-sidebar-group');

/** The service style's top-level section titles (Framework, Services); none in the package style. */
export const sectionTitles = (page: Page) => topLevel(page).locator(':scope > p.api-sidebar-section-title');
