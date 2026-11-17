/**
 * Class toggling for the member-row flash, in plain Node. The browser half
 * (the fade, reduced motion, the real jump paths) lives in test/e2e/member-flash.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FLASH_CLASS,
  FLASH_DURATION_MS,
  FlashDocument,
  FlashElement,
  READY_CLASS,
  clearFlash,
  flashRow,
  rowForHash,
} from '../docs/.vitepress/theme/member-flash.js';

/** A fake element: a class set and whether it is a member row. */
function element(isRow: boolean): FlashElement & { classes: Set<string> } {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
    },
    matches: (selector) => isRow && selector.includes('.member-row'),
  };
}

function document(ids: Record<string, FlashElement>): FlashDocument {
  return {
    getElementById: (id) => ids[id] ?? null,
    querySelectorAll: (selector) =>
      Object.values(ids).filter((el) => el.classList.contains(selector.replace(/^\./, ''))),
  };
}

describe('rowForHash', () => {
  test('resolves a member row by its hash', () => {
    const row = element(true);
    expect(rowForHash(document({ bucketname: row }), '#bucketname')).toBe(row);
  });

  test('decodes a percent-encoded hash', () => {
    const row = element(true);
    expect(rowForHash(document({ 'add-to-role-policy': row }), '#add%2Dto-role-policy')).toBe(row);
  });

  test('ignores an empty hash, a heading and a missing id', () => {
    const heading = element(false);
    const doc = document({ methods: heading });
    expect(rowForHash(doc, '')).toBeNull();
    expect(rowForHash(doc, '#')).toBeNull();
    expect(rowForHash(doc, '#methods')).toBeNull();
    expect(rowForHash(doc, '#nothing')).toBeNull();
  });

  test('a malformed escape is no row rather than an exception', () => {
    expect(rowForHash(document({}), '#%E0%A4%A')).toBeNull();
  });
});

describe('flashRow', () => {
  test('marks the landed row and returns it', () => {
    const row = element(true);
    const result = flashRow(document({ a: row }), '#a');
    expect(result).toBe(row);
    expect(row.classes.has(FLASH_CLASS)).toBe(true);
  });

  test('a second jump moves the mark to the new row', () => {
    const first = element(true);
    const second = element(true);
    const doc = document({ a: first, b: second });
    flashRow(doc, '#a');
    flashRow(doc, '#b');
    expect(first.classes.has(FLASH_CLASS)).toBe(false);
    expect(second.classes.has(FLASH_CLASS)).toBe(true);
  });

  test('a jump to a non-member anchor clears the earlier mark', () => {
    const row = element(true);
    const heading = element(false);
    const doc = document({ a: row, methods: heading });
    flashRow(doc, '#a');
    expect(flashRow(doc, '#methods')).toBeNull();
    expect(row.classes.has(FLASH_CLASS)).toBe(false);
    expect(heading.classes.has(FLASH_CLASS)).toBe(false);
  });

  test('a repeat jump to the same row removes the class before re-adding it, so the fade restarts', () => {
    const row = element(true);
    const doc = document({ a: row });
    flashRow(doc, '#a');
    const seen: boolean[] = [];
    flashRow(doc, '#a', (el) => seen.push(el.classList.contains(FLASH_CLASS)));
    // The restart hook runs between removal and re-addition.
    expect(seen).toEqual([false]);
    expect(row.classes.has(FLASH_CLASS)).toBe(true);
  });

  test('clearFlash removes the mark from every row carrying it', () => {
    const a = element(true);
    const b = element(true);
    a.classList.add(FLASH_CLASS);
    b.classList.add(FLASH_CLASS);
    clearFlash(document({ a, b }));
    expect(a.classes.has(FLASH_CLASS)).toBe(false);
    expect(b.classes.has(FLASH_CLASS)).toBe(false);
  });
});

describe('stylesheet', () => {
  const css = () => readFileSync(resolve(import.meta.dirname, '../docs/.vitepress/theme/api-layout.css'), 'utf-8');

  test('the flash class animates from the flash color to the row background over the module duration, ease out', () => {
    const sheet = css();
    const at = sheet.indexOf('@keyframes member-row-flash {');
    expect(at).toBeGreaterThan(-1);
    const keyframes = sheet.slice(at, sheet.indexOf('\n}', at));
    expect(keyframes).toMatch(/from \{[^}]*background-color: var\(--api-c-flash\)/);
    // No `to` frame: the fade ends at whatever the row's own background is, so
    // nothing snaps when the class is removed.
    expect(keyframes).not.toContain('to {');
    expect(sheet).toMatch(
      new RegExp(`\\.member-list \\.member-row\\.${FLASH_CLASS} \\{[^}]*animation: member-row-flash ${FLASH_DURATION_MS}ms ease-out;`),
    );
    expect(FLASH_DURATION_MS).toBe(1500);
  });

  test('the :target tint yields to the flash once the module is installed', () => {
    // The browser never moves `:target` on a pushState jump, so with the flash
    // installed the first-loaded row would otherwise keep a tint beside every
    // later landing. The rule stays for the no-JS case.
    expect(css()).toMatch(
      new RegExp(`html:not\\(\\.${READY_CLASS}\\) \\.member-list \\.member-row:target \\{[^}]*background-color: var\\(--vp-c-bg-soft\\)`),
    );
  });

  test('reduced motion shows the static tint with no animation', () => {
    const sheet = css();
    const reduced = sheet.slice(sheet.indexOf('@media (prefers-reduced-motion: reduce)'));
    const rule = reduced.slice(reduced.indexOf(`.member-row.${FLASH_CLASS}`));
    const body = rule.slice(rule.indexOf('{'), rule.indexOf('}'));
    expect(body).toContain('animation: none');
    expect(body).toContain('background-color: var(--vp-c-bg-soft)');
  });
});
