import { appendToHeading } from './anchors.js';
import { VERSION_PARSE_PATTERN } from './version-format.js';

/**
 * Append badges to the first H1 line of a rendered markdown page, so
 * they display next to the page title.
 */
export function injectBadges(markdown: string, badges: string[]): string {
  if (badges.length === 0) {
    return markdown;
  }
  const lines = markdown.split('\n');
  const h1 = lines.findIndex((line) => line.startsWith('# '));
  if (h1 === -1) {
    return markdown;
  }
  lines[h1] = appendToHeading(lines[h1], badges.join(' '));
  return lines.join('\n');
}

/**
 * True when `latest` is a strictly newer semver release than `current`.
 * Used by the cdk-version-check workflow to decide whether to open a
 * version-update PR. Pre-release/build suffixes are ignored: the
 * workflow only tracks stable aws-cdk-lib releases.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] => {
    const match = v.trim().match(VERSION_PARSE_PATTERN);
    if (!match) {
      throw new Error(`Invalid version: "${v}"`);
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i++) {
    if (b[i] !== a[i]) {
      return b[i] > a[i];
    }
  }
  return false;
}
