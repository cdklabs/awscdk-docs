import * as crypto from 'crypto';
import * as fs from 'fs';
import * as spec from '@jsii/spec';

/**
 * Version history of every documented type and README: the release each was introduced in, the release its
 * observable shape last changed in, and when. Persisted in `docgen.baseline.json` as an accumulating ledger the
 * nightly version refresh updates and the docs build only reads.
 */

/**
 * Identifies the fingerprint algorithm the stored hashes were computed with. Bump it whenever either fingerprint
 * definition changes: {@link updateLedger} refuses a ledger written by a different algorithm, because comparing
 * hashes across definitions would mark the whole library as changed in one release.
 */
export const FINGERPRINT_VERSION = 1;

/** Hex length of a stored fingerprint: 48 bits, where 32 bits would give ~10% odds of a collision at 30k entries. */
const FINGERPRINT_HEX = 12;

/**
 * One ledger row: `[introducedIn, lastChangedIn, lastChangedAt, fingerprint]`. The two versions are indices into
 * {@link Ledger.versions}; `null` means unknown (the entry predates the recorded window). An empty fingerprint means
 * the shape was never recorded — a row migrated from the flat FQN list — and is filled in without counting as a change.
 */
export type LedgerEntry = readonly [
  introducedIn: number | null,
  lastChangedIn: number | null,
  lastChangedAt: string | null,
  fingerprint: string,
];

export interface Ledger {
  readonly fingerprintVersion: number;
  /** Interned version strings; entries refer to them by index. */
  readonly versions: string[];
  /** Keyed by type FQN. Removed types are kept: a re-added type then carries honest history. */
  readonly types: Record<string, LedgerEntry>;
  /** Keyed by `<assembly>` for the root README and `<assembly>.<submodule>` for a submodule README. */
  readonly readmes: Record<string, LedgerEntry>;
}

/** History of one page as the renderers consume it: versions resolved, unknowns absent. */
export interface PageHistory {
  readonly introducedIn?: string;
  readonly lastChangedIn?: string;
  /** ISO timestamp; present exactly when `lastChangedIn` is. */
  readonly lastChangedAt?: string;
}

export function emptyLedger(): Ledger {
  return { fingerprintVersion: FINGERPRINT_VERSION, versions: [], types: {}, readmes: {} };
}

export interface LoadedLedger {
  readonly ledger: Ledger;
  /** True when the file was a pre-ledger flat FQN baseline, converted in memory — the one update that migrates. */
  readonly migrated: boolean;
}

/**
 * Read the ledger file, or `undefined` when it does not exist. A pre-ledger baseline (`{ assemblies: { name:
 * { version, types: string[] } } }`) is converted in memory: every listed FQN becomes a row with unknown history and
 * no fingerprint, so the first {@link updateLedger} records shapes without inventing dates, and types absent from
 * the list still read as introduced in the installed release. The conversion is reported, not inferred later: a
 * listed type that is no longer installed keeps its empty fingerprint forever, so the rows cannot say whether this
 * is the migration run.
 */
export function readLedger(file: string): LoadedLedger | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (raw && typeof raw.assemblies === 'object' && raw.assemblies !== null && raw.types === undefined) {
    const ledger = emptyLedger();
    for (const entry of Object.values(raw.assemblies) as { types?: unknown }[]) {
      for (const fqn of Array.isArray(entry.types) ? entry.types : []) {
        ledger.types[String(fqn)] = [null, null, null, ''];
      }
    }
    return { ledger, migrated: true };
  }
  for (const key of ['versions', 'types', 'readmes'] as const) {
    if (typeof raw[key] !== 'object' || raw[key] === null) {
      throw new Error(`${file}: "${key}" must be an object`);
    }
  }
  if (typeof raw.fingerprintVersion !== 'number') {
    throw new Error(`${file}: "fingerprintVersion" must be a number`);
  }
  return { ledger: raw as Ledger, migrated: false };
}

/** The ledger as the docs build reads it: history only, no update concerns. */
export function loadLedger(file: string): Ledger | undefined {
  return readLedger(file)?.ledger;
}

/** Compact JSON: one row per line keeps the bump-PR diff readable without paying for pretty-printed tuples. */
export function writeLedger(file: string, ledger: Ledger): void {
  const rows = (map: Record<string, LedgerEntry>): string => {
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      return '{}';
    }
    return `{\n${keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`).join(',\n')}\n  }`;
  };
  const text = [
    '{',
    `  "fingerprintVersion": ${ledger.fingerprintVersion},`,
    `  "versions": ${JSON.stringify(ledger.versions)},`,
    `  "types": ${rows(ledger.types)},`,
    `  "readmes": ${rows(ledger.readmes)}`,
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(file, text);
}

function resolve(ledger: Ledger, entry: LedgerEntry | undefined): PageHistory {
  if (!entry) {
    return {};
  }
  const [intro, changed, changedAt] = entry;
  return {
    ...(intro !== null ? { introducedIn: ledger.versions[intro] } : {}),
    ...(changed !== null && changedAt ? { lastChangedIn: ledger.versions[changed], lastChangedAt: changedAt } : {}),
  };
}

/** History of a type page, or `{}` when the ledger has nothing for it. */
export function typeHistory(ledger: Ledger | undefined, fqn: string): PageHistory {
  return ledger ? resolve(ledger, ledger.types[fqn]) : {};
}

/** History of a README page, keyed as in {@link Ledger.readmes}. */
export function readmeHistory(ledger: Ledger | undefined, key: string): PageHistory {
  return ledger ? resolve(ledger, ledger.readmes[key]) : {};
}

/**
 * True when `introducedIn` shares `major.minor` with the documented version, patch ignored — so everything added in
 * one minor line reads as new for the life of that minor. Unknown never reads as new: it predates the window.
 */
export function isAddedIn(history: PageHistory, documentedVersion: string): boolean {
  if (!history.introducedIn) {
    return false;
  }
  return minorLine(history.introducedIn) === minorLine(documentedVersion);
}

function minorLine(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

/** H1 badge for a page introduced in the documented minor line. */
export function addedInBadge(introducedIn: string): string {
  // `api-badge` carries no color of its own; it opts this badge into the H1 alignment override, because
  // `injectBadges` appends it to the same line box as the kind badge and the source chip.
  return `<Badge type="tip" class="api-badge" text="Added in v${introducedIn}" />`;
}

// ---------------------------------------------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------------------------------------------

function hash(parts: string): string {
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, FINGERPRINT_HEX);
}

function typeRef(ref: spec.TypeReference | undefined): string {
  if (!ref) {
    return '-';
  }
  if (spec.isPrimitiveTypeReference(ref)) {
    return ref.primitive;
  }
  if (spec.isNamedTypeReference(ref)) {
    return ref.fqn;
  }
  if (spec.isCollectionTypeReference(ref)) {
    return `${ref.collection.kind}<${typeRef(ref.collection.elementtype)}>`;
  }
  if (spec.isUnionTypeReference(ref)) {
    return `(${ref.union.types.map(typeRef).sort().join('|')})`;
  }
  // A shape this build does not know: serialize it whole so an unknown kind still participates deterministically.
  return JSON.stringify(ref, Object.keys(ref).sort());
}

function parameter(p: spec.Parameter): string {
  return [p.name, typeRef(p.type), p.optional ? '?' : '', p.variadic ? '...' : ''].join('');
}

function flags(...pairs: [string, unknown][]): string {
  return pairs.filter(([, on]) => Boolean(on)).map(([name]) => name).join(',');
}

function method(m: spec.Method): string {
  return [
    'm', m.name ?? '',
    (m.parameters ?? []).map(parameter).join(','),
    typeRef(m.returns?.type),
    flags(['static', m.static], ['abstract', m.abstract], ['async', m.async], ['protected', m.protected],
      ['deprecated', m.docs?.deprecated !== undefined]),
    m.docs?.stability ?? '',
  ].join('|');
}

function property(p: spec.Property): string {
  return [
    'p', p.name, typeRef(p.type),
    flags(['optional', p.optional], ['immutable', p.immutable], ['static', p.static], ['abstract', p.abstract],
      ['const', p.const], ['protected', p.protected], ['deprecated', p.docs?.deprecated !== undefined]),
    p.docs?.default ?? '',
    p.docs?.stability ?? '',
  ].join('|');
}

/**
 * Fingerprint of a type's observable shape: kind, bases, initializer, and every member's name, types, flags,
 * `@default`, stability and deprecation — members sorted, so ordering is not a change. Prose (`summary`, `remarks`,
 * `see`, `example`, `custom`) and `locationInModule` are excluded: line numbers move whenever anything above them in
 * the file does, and including them would flag most of the library on most releases.
 */
export function typeFingerprint(type: spec.Type): string {
  const parts: string[] = [type.kind, type.docs?.deprecated !== undefined ? 'deprecated' : '', type.docs?.stability ?? ''];
  if (spec.isClassType(type)) {
    parts.push(
      type.base ?? '',
      [...(type.interfaces ?? [])].sort().join(','),
      type.abstract ? 'abstract' : '',
      type.initializer ? (type.initializer.parameters ?? []).map(parameter).join(',') : 'noinit',
    );
  } else if (spec.isInterfaceType(type)) {
    parts.push([...(type.interfaces ?? [])].sort().join(','), type.datatype ? 'struct' : '');
  } else if (spec.isEnumType(type)) {
    parts.push(type.members.map((m) => m.name).sort().join(','));
  }
  const members: string[] = [];
  if (spec.isClassOrInterfaceType(type)) {
    members.push(...(type.methods ?? []).map(method), ...(type.properties ?? []).map(property));
  }
  parts.push(...members.sort());
  return hash(parts.join('\n'));
}

/** Fingerprint of a README exactly as the assembly ships it, so translation and rendering changes are not changes. */
export function readmeFingerprint(markdown: string): string {
  return hash(markdown);
}

// ---------------------------------------------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------------------------------------------

export interface UpdateOptions {
  /**
   * Publish time of an assembly's release, when known (the committed version snapshot has it for tracked
   * packages). Falls back to `now` — the run that observed the change.
   */
  readonly releasedAt?: (assembly: spec.Assembly) => string | undefined;
  /** Clock for the fallback; injectable so tests are deterministic. */
  readonly now?: () => Date;
  /**
   * This update migrates a flat FQN baseline ({@link LoadedLedger.migrated}). That file said nothing about READMEs,
   * so on this one run every README gets unknown history rather than a fresh introduction; on every later run a
   * README first seen is genuinely new.
   */
  readonly migrating?: boolean;
}

export interface UpdateSummary {
  readonly introduced: string[];
  readonly changed: string[];
  /** Keys recorded with unknown history because their package is documented here for the first time. */
  readonly seeded: string[];
}

/**
 * Bring the ledger up to the installed assemblies. A key never seen is introduced in (and last changed in) the
 * installed release; a recorded shape that differs is last changed in it; a row with no recorded shape has its
 * fingerprint filled in with no other change, because there is nothing to compare against. Rows for keys no longer
 * installed are left alone. Idempotent: running twice against the same install changes nothing the second time.
 *
 * Keys of an assembly the ledger holds no rows for are seeded with unknown history instead: the package is documented
 * here for the first time, so its age is not the installed release and the site must not claim it. An empty ledger is
 * exempt, being a deliberate from-scratch seed.
 *
 * Refuses a ledger whose `fingerprintVersion` differs from {@link FINGERPRINT_VERSION}: re-fingerprinting under a new
 * definition must be a deliberate re-seed (see the ADR), never a silent library-wide change.
 */
export function updateLedger(ledger: Ledger, assemblies: readonly spec.Assembly[], options: UpdateOptions = {}): UpdateSummary {
  if (ledger.fingerprintVersion !== FINGERPRINT_VERSION) {
    throw new Error(
      `ledger was written with fingerprintVersion ${ledger.fingerprintVersion}, this build computes version `
      + `${FINGERPRINT_VERSION}; re-seed the ledger deliberately instead of comparing hashes across definitions`,
    );
  }
  const summary = { introduced: [] as string[], changed: [] as string[], seeded: [] as string[] };
  const versionIndex = (version: string): number => {
    const found = ledger.versions.indexOf(version);
    if (found >= 0) {
      return found;
    }
    ledger.versions.push(version);
    return ledger.versions.length - 1;
  };
  const migrating = options.migrating ?? false;
  const recorded = [...Object.keys(ledger.types), ...Object.keys(ledger.readmes)];
  const recordedKeys = new Set(recorded);
  // An empty ledger is a deliberate from-scratch seed, where the installed release is all the evidence there is.
  const documented = (assembly: spec.Assembly): boolean => recorded.length === 0
    || recordedKeys.has(assembly.name)
    || recorded.some((key) => key.startsWith(`${assembly.name}.`));
  const apply = (map: Record<string, LedgerEntry>, key: string, fingerprint: string, assembly: spec.Assembly,
    firstDocumented: boolean): void => {
    const previous = map[key];
    if (previous && previous[3] === fingerprint) {
      return;
    }
    if (previous && previous[3] === '') {
      map[key] = [previous[0], previous[1], previous[2], fingerprint];
      return;
    }
    if (!previous && firstDocumented) {
      map[key] = [null, null, null, fingerprint];
      summary.seeded.push(key);
      return;
    }
    if (!previous && map === ledger.readmes && migrating) {
      map[key] = [null, null, null, fingerprint];
      return;
    }
    const at = options.releasedAt?.(assembly) ?? (options.now ?? (() => new Date()))().toISOString();
    const idx = versionIndex(assembly.version);
    if (previous) {
      map[key] = [previous[0], idx, at, fingerprint];
      summary.changed.push(key);
    } else {
      map[key] = [idx, idx, at, fingerprint];
      summary.introduced.push(key);
    }
  };
  for (const assembly of assemblies) {
    const firstDocumented = !documented(assembly);
    for (const [fqn, type] of Object.entries(assembly.types ?? {})) {
      apply(ledger.types, fqn, typeFingerprint(type), assembly, firstDocumented);
    }
    if (assembly.readme?.markdown !== undefined) {
      apply(ledger.readmes, assembly.name, readmeFingerprint(assembly.readme.markdown), assembly, firstDocumented);
    }
    // Submodule keys are FQNs already (`aws-cdk-lib.aws_s3`), the same key the overview pages use.
    for (const [fqn, sub] of Object.entries(assembly.submodules ?? {})) {
      if (sub.readme?.markdown !== undefined) {
        apply(ledger.readmes, fqn, readmeFingerprint(sub.readme.markdown), assembly, firstDocumented);
      }
    }
  }
  return summary;
}
