import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const ADR_DIR = resolve(ROOT, 'docs/adr');

// ADR hygiene: every ADR must follow the AGENTS.md template, and
// cross-references must point at files that exist — sequential ADR-0000 ids
// are banned and resolve to nothing.
describe('ADR hygiene', () => {
  const adrs = readdirSync(ADR_DIR).filter((f) => f.endsWith('.md'));

  test.each(adrs)('%s has a "## Status" heading with a capitalized value', (file) => {
    const body = readFileSync(resolve(ADR_DIR, file), 'utf-8');
    // The heading, then (after blank lines) a status line starting with a
    // capitalized word (Accepted, Proposed, Superseded, ...).
    expect(body).toMatch(/^## Status\n+[A-Z][a-z]+/m);
    // No metadata-bullet or bare-line variant of the status anywhere.
    expect(body).not.toMatch(/^-? ?Status: /m);
  });

  test.each(adrs)('%s has no sequential ADR ids and its ADR file references resolve', (file) => {
    const body = readFileSync(resolve(ADR_DIR, file), 'utf-8');
    expect(body).not.toMatch(/ADR-\d+/);
    for (const m of body.matchAll(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md)\b/g)) {
      expect(adrs).toContain(m[1]);
    }
  });
});
