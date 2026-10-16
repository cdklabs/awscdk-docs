import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  injectSiteStamp,
  readSiteStampValue,
  renderSiteStamp,
  STAMP_BEGIN,
  STAMP_END,
  STAMP_GENERATED_AT_META,
  STAMP_VERSION_META,
  stampGeneratedAt,
  StampSource,
  stampVersion,
} from '../src/site-stamp.js';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

const STAMP = { version: '2.268.0', generatedAt: '2026-09-10T09:47:12.000Z' };

/**
 * Minimal stand-in for `document`, resolving the same `meta[name="…"]` selector the readers pass. Regex-based on
 * purpose: it exercises the real selector string rather than a pre-parsed map.
 */
function domOf(html: string): StampSource {
  return {
    querySelector(selectors: string) {
      const name = /^meta\[name="([^"]+)"\]$/.exec(selectors)?.[1];
      if (!name) {
        return null;
      }
      const tag = new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html);
      return tag ? { getAttribute: (attr: string) => (attr === 'content' ? tag[1] : null) } : null;
    },
  };
}

/** What the downstream Python script does: swap one stamped value, touching nothing else. */
function replaceStamped(html: string, metaName: string, value: string): string {
  return html.replace(
    new RegExp(`(<meta name="${metaName}" content=")[^"]*`),
    `$1${value}`,
  );
}

describe('stamp block', () => {
  const block = renderSiteStamp(STAMP);

  test('carries both values between the sentinels', () => {
    expect(block.startsWith(STAMP_BEGIN)).toBe(true);
    expect(block.endsWith(STAMP_END)).toBe(true);
    expect(block).toContain(`<meta name="${STAMP_VERSION_META}" content="2.268.0">`);
    expect(block).toContain(
      `<meta name="${STAMP_GENERATED_AT_META}" content="2026-09-10T09:47:12.000Z">`,
    );
  });

  test('values are attribute-escaped, so none can break out or close the comment early', () => {
    const hostile = renderSiteStamp({
      version: '2.0.0"><script>alert(1)</script>',
      generatedAt: '--> <img onerror=x>',
    });
    expect(hostile).not.toContain('<script>');
    expect(hostile).not.toContain('<img');
    // Neither comment terminator can appear between the sentinels — `--!>` ends
    // a comment too, so escaping `>` is what makes the block tamper-proof.
    const inner = hostile.slice(STAMP_BEGIN.length, hostile.length - STAMP_END.length);
    expect(inner.includes('-->')).toBe(false);
    expect(inner.includes('--!>')).toBe(false);
    // Exactly the two metas the block declares, no third tag spliced in.
    expect(inner.split('<meta ').length - 1).toBe(2);
  });
});

describe('injecting the stamp into a page', () => {
  const page = '<html><head><title>Topic</title></head><body><div id="app">x</div></body></html>';

  test('lands at the end of <head>, outside the Vue app', () => {
    const stamped = injectSiteStamp(page, STAMP);
    expect(stamped.indexOf(STAMP_BEGIN)).toBeGreaterThan(stamped.indexOf('<title>'));
    expect(stamped.indexOf(STAMP_END)).toBeLessThan(stamped.indexOf('</head>'));
    expect(stamped.indexOf(STAMP_END)).toBeLessThan(stamped.indexOf('<div id="app">'));
  });

  test('a page without a head still gets stamped', () => {
    expect(injectSiteStamp('<p>bare</p>', STAMP)).toContain(STAMP_BEGIN);
  });

  test('stamping twice leaves one block, so a replacement has a single target', () => {
    const once = injectSiteStamp(page, STAMP);
    const twice = injectSiteStamp(once, { version: '9.9.9', generatedAt: '2027-01-01T00:00:00.000Z' });
    expect(twice).toBe(once);
    expect(twice.match(new RegExp(STAMP_BEGIN, 'g'))).toHaveLength(1);
  });
});

describe('reading the stamp back', () => {
  const stamped = injectSiteStamp('<html><head></head><body></body></html>', STAMP);

  test('round-trips both values', () => {
    expect(stampVersion(domOf(stamped))).toBe('2.268.0');
    expect(stampGeneratedAt(domOf(stamped))).toBe('2026-09-10T09:47:12.000Z');
  });

  test('a rewritten stamp is what the readers report — the downstream contract', () => {
    let republished = replaceStamped(stamped, STAMP_VERSION_META, '3.1.4');
    republished = replaceStamped(republished, STAMP_GENERATED_AT_META, '2030-05-06T07:08:09.000Z');
    expect(stampVersion(domOf(republished))).toBe('3.1.4');
    expect(stampGeneratedAt(domOf(republished))).toBe('2030-05-06T07:08:09.000Z');
  });

  test('an unstamped page reads as undefined, so callers can fall back', () => {
    // Distinct from a stamped-but-blank value: the dev server renders pages
    // without the stamp and must keep showing the build-time version.
    expect(stampVersion(domOf('<html><head></head></html>'))).toBeUndefined();
    expect(stampVersion(domOf(injectSiteStamp('<head></head>', { ...STAMP, version: '' })))).toBe('');
  });

  test('surrounding whitespace is trimmed rather than returned', () => {
    const padded = '<meta name="cdk-docs-version" content="  2.1.0  ">';
    expect(readSiteStampValue(domOf(padded), STAMP_VERSION_META)).toBe('2.1.0');
  });
});

describe('build wiring', () => {
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');

  test('every built page is stamped through the shared helper', () => {
    expect(config).toContain('transformHtml(');
    expect(config).toContain('injectSiteStamp(code');
    expect(config).toContain('from "../../src/site-stamp"');
  });

  test('the stamped timestamp is the snapshot\'s, so two builds of one commit agree', () => {
    expect(config).toContain('readVersionSnapshot(snapshotPath).generatedAt');
    expect(config).not.toContain('generatedAt: new Date()');
  });

  test('the stamped version is validated before it reaches the artifact', () => {
    expect(config).toContain('assertValidVersion(');
  });
});

describe('theme reads the stamp, not the metadata chunk', () => {
  test('the navbar badge prefers the stamp and falls back to themeConfig', () => {
    const badge = readFileSync(resolve(THEME_DIR, 'VersionBadge.vue'), 'utf-8');
    expect(badge).toContain('stampVersion(document)');
    expect(badge).toContain('stamped ?? theme.value.cdkVersion');
  });

  test('the report-issue template reports the stamped version', () => {
    const footer = readFileSync(resolve(THEME_DIR, 'PageFooterLinks.vue'), 'utf-8');
    expect(footer).toContain('stampVersion(document) ?? theme.value.cdkVersion');
  });

  test('the versions page dates itself from the stamp', () => {
    const page = readFileSync(resolve(ROOT, 'docs/versions.md'), 'utf-8');
    expect(page).toContain('stampGeneratedAt(document)');
    // `??`, not `||`: a stamped empty value is an answer, not a missing stamp —
    // the same precedence the other two consumers use. The sentence is then
    // dropped rather than rendered without a date (pinned as behavior in
    // test/e2e/build-stamp.spec.ts).
    expect(page).toContain('stamped ?? data.generatedAt');
    expect(page).toContain('v-if="lastUpdated"');
  });
});
