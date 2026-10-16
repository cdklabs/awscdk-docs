import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as spec from '@jsii/spec';
import {
  emptyLedger,
  FINGERPRINT_VERSION,
  isAddedIn,
  Ledger,
  loadLedger,
  readLedger,
  readmeFingerprint,
  readmeHistory,
  typeFingerprint,
  typeHistory,
  updateLedger,
  writeLedger,
} from '../src/docgen/history.js';

const NOW = () => new Date('2026-09-11T06:00:00.000Z');

function topic(overrides: Partial<spec.ClassType> = {}): spec.ClassType {
  return {
    assembly: 'aws-cdk-lib',
    fqn: 'aws-cdk-lib.aws_sns.Topic',
    kind: spec.TypeKind.Class,
    name: 'Topic',
    namespace: 'aws_sns',
    base: 'aws-cdk-lib.Resource',
    interfaces: ['aws-cdk-lib.aws_sns.ITopic'],
    locationInModule: { filename: 'lib/topic.ts', line: 40 },
    docs: { summary: 'A new SNS topic.', remarks: 'Long remarks.' },
    initializer: {
      parameters: [
        { name: 'scope', type: { fqn: 'constructs.Construct' } },
        { name: 'id', type: { primitive: spec.PrimitiveType.String } },
        { name: 'props', type: { fqn: 'aws-cdk-lib.aws_sns.TopicProps' }, optional: true },
      ],
    },
    methods: [
      {
        name: 'addSubscription',
        parameters: [{ name: 'subscription', type: { fqn: 'aws-cdk-lib.aws_sns.ITopicSubscription' } }],
        returns: { type: { fqn: 'aws-cdk-lib.aws_sns.Subscription' } },
        docs: { summary: 'Subscribe.' },
      },
      { name: 'grantPublish', parameters: [{ name: 'grantee', type: { fqn: 'aws-cdk-lib.aws_iam.IGrantable' } }] },
    ],
    properties: [
      { name: 'topicArn', type: { primitive: spec.PrimitiveType.String }, immutable: true },
      { name: 'fifo', type: { primitive: spec.PrimitiveType.Boolean }, immutable: true, docs: { default: 'false' } },
    ],
    ...overrides,
  };
}

function assembly(types: spec.Type[], extra: Partial<spec.Assembly> = {}): spec.Assembly {
  return {
    schema: spec.SchemaVersion.LATEST,
    name: 'aws-cdk-lib',
    version: '2.268.0',
    fingerprint: 'x',
    jsiiVersion: '5',
    license: 'Apache-2.0',
    homepage: 'h',
    repository: { type: 'git', url: 'u' },
    author: { name: 'a', roles: [] },
    description: 'd',
    types: Object.fromEntries(types.map((t) => [t.fqn, t])),
    readme: { markdown: '# aws-cdk-lib\n' },
    submodules: { 'aws-cdk-lib.aws_sns': { readme: { markdown: '# SNS\n' } } },
    ...extra,
  };
}

describe('typeFingerprint', () => {
  const base = typeFingerprint(topic());

  test.each<[string, Partial<spec.ClassType>]>([
    ['summary rewritten', { docs: { summary: 'Different words.', remarks: 'Long remarks.' } }],
    ['remarks reworded', { docs: { summary: 'A new SNS topic.', remarks: 'Other remarks.' } }],
    ['see/example/custom added', { docs: { summary: 'A new SNS topic.', see: 'x', example: 'y', custom: { z: '1' } } }],
    ['source location moved', { locationInModule: { filename: 'lib/topic.ts', line: 400 } }],
    ['members reordered', {
      methods: [...topic().methods!].reverse(),
      properties: [...topic().properties!].reverse(),
    }],
    ['member summary rewritten', {
      methods: topic().methods!.map((m) => (m.name === 'addSubscription' ? { ...m, docs: { summary: 'Else.' } } : m)),
    }],
  ])('does not move when %s', (_name, override) => {
    expect(typeFingerprint(topic(override))).toBe(base);
  });

  test.each<[string, Partial<spec.ClassType>]>([
    ['an optional property is added', {
      properties: [...topic().properties!, { name: 'extra', type: { primitive: spec.PrimitiveType.String }, optional: true }],
    }],
    ['a property becomes optional', {
      properties: topic().properties!.map((p) => (p.name === 'fifo' ? { ...p, optional: true } : p)),
    }],
    ['a parameter type changes', {
      methods: topic().methods!.map((m) => (m.name === 'grantPublish'
        ? { ...m, parameters: [{ name: 'grantee', type: { fqn: 'aws-cdk-lib.aws_iam.IPrincipal' } }] }
        : m)),
    }],
    ['a return type changes', {
      methods: topic().methods!.map((m) => (m.name === 'addSubscription'
        ? { ...m, returns: { type: { primitive: spec.PrimitiveType.Any } } }
        : m)),
    }],
    ['a method is deprecated', {
      methods: topic().methods!.map((m) => (m.name === 'grantPublish' ? { ...m, docs: { deprecated: 'use x' } } : m)),
    }],
    ['a @default changes', {
      properties: topic().properties!.map((p) => (p.name === 'fifo' ? { ...p, docs: { default: 'true' } } : p)),
    }],
    ['an initializer parameter is removed', {
      initializer: { parameters: topic().initializer!.parameters!.slice(0, 2) },
    }],
    ['the base class changes', { base: 'aws-cdk-lib.Construct' }],
    ['a method is removed', { methods: topic().methods!.slice(1) }],
  ])('moves when %s', (_name, override) => {
    expect(typeFingerprint(topic(override))).not.toBe(base);
  });

  test('is 12 lower-case hex characters', () => {
    expect(base).toMatch(/^[0-9a-f]{12}$/);
  });

  test('distinguishes an enum by its member names, not their docs', () => {
    const e = (members: spec.EnumMember[]): spec.EnumType => ({
      assembly: 'aws-cdk-lib', fqn: 'aws-cdk-lib.E', kind: spec.TypeKind.Enum, name: 'E', members,
    });
    const a = typeFingerprint(e([{ name: 'A' }, { name: 'B', docs: { summary: 'b' } }]));
    expect(typeFingerprint(e([{ name: 'B' }, { name: 'A' }]))).toBe(a);
    expect(typeFingerprint(e([{ name: 'A' }, { name: 'C' }]))).not.toBe(a);
  });
});

describe('readmeFingerprint', () => {
  test('is over the assembly markdown, byte for byte', () => {
    expect(readmeFingerprint('# A\n')).toBe(readmeFingerprint('# A\n'));
    expect(readmeFingerprint('# A\n')).not.toBe(readmeFingerprint('# A \n'));
    expect(readmeFingerprint('# A\n')).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('updateLedger', () => {
  test('introduces unseen keys in the installed release, dated by the release when known', () => {
    const ledger = emptyLedger();
    const summary = updateLedger(ledger, [assembly([topic()])], {
      now: NOW,
      releasedAt: () => '2026-09-10T06:29:13.000Z',
    });
    expect(summary).toEqual({
      introduced: ['aws-cdk-lib.aws_sns.Topic', 'aws-cdk-lib', 'aws-cdk-lib.aws_sns'],
      changed: [],
      seeded: [],
    });
    expect(ledger.versions).toEqual(['2.268.0']);
    expect(typeHistory(ledger, 'aws-cdk-lib.aws_sns.Topic')).toEqual({
      introducedIn: '2.268.0',
      lastChangedIn: '2.268.0',
      lastChangedAt: '2026-09-10T06:29:13.000Z',
    });
    expect(readmeHistory(ledger, 'aws-cdk-lib.aws_sns')).toEqual({
      introducedIn: '2.268.0',
      lastChangedIn: '2.268.0',
      lastChangedAt: '2026-09-10T06:29:13.000Z',
    });
  });

  test('falls back to the clock when the release time is unknown', () => {
    const ledger = emptyLedger();
    updateLedger(ledger, [assembly([topic()])], { now: NOW });
    expect(typeHistory(ledger, 'aws-cdk-lib.aws_sns.Topic').lastChangedAt).toBe('2026-09-11T06:00:00.000Z');
  });

  test('records a shape change against the new release and keeps the introduction', () => {
    const ledger = emptyLedger();
    updateLedger(ledger, [assembly([topic()], { version: '2.267.0' })], { now: () => new Date('2026-09-03T00:00:00Z') });
    const changed = topic({ methods: topic().methods!.slice(1) });
    const summary = updateLedger(ledger, [assembly([changed], { version: '2.268.0' })], { now: NOW });
    expect(summary.changed).toEqual(['aws-cdk-lib.aws_sns.Topic']);
    expect(summary.introduced).toEqual([]);
    expect(ledger.versions).toEqual(['2.267.0', '2.268.0']);
    expect(typeHistory(ledger, 'aws-cdk-lib.aws_sns.Topic')).toEqual({
      introducedIn: '2.267.0',
      lastChangedIn: '2.268.0',
      lastChangedAt: '2026-09-11T06:00:00.000Z',
    });
    // The READMEs did not change, so they still carry the first release.
    expect(readmeHistory(ledger, 'aws-cdk-lib').lastChangedIn).toBe('2.267.0');
  });

  test('a docs-only release changes nothing', () => {
    const ledger = emptyLedger();
    updateLedger(ledger, [assembly([topic()], { version: '2.267.0' })], { now: NOW });
    const before = JSON.stringify(ledger);
    const docsOnly = topic({ docs: { summary: 'Reworded.' }, locationInModule: { filename: 'lib/topic.ts', line: 9 } });
    const summary = updateLedger(ledger, [assembly([docsOnly], { version: '2.268.0' })], { now: NOW });
    expect(summary).toEqual({ introduced: [], changed: [], seeded: [] });
    expect(JSON.stringify(ledger)).toBe(before);
  });

  test('is idempotent against the same install', () => {
    const ledger = emptyLedger();
    updateLedger(ledger, [assembly([topic()])], { now: NOW });
    const once = JSON.stringify(ledger);
    expect(updateLedger(ledger, [assembly([topic()])], { now: () => new Date('2027-01-01T00:00:00Z') }))
      .toEqual({ introduced: [], changed: [], seeded: [] });
    expect(JSON.stringify(ledger)).toBe(once);
  });

  test('keeps rows for types no longer installed', () => {
    const ledger = emptyLedger();
    updateLedger(ledger, [assembly([topic()])], { now: NOW });
    updateLedger(ledger, [assembly([], { version: '2.269.0' })], { now: NOW });
    expect(typeHistory(ledger, 'aws-cdk-lib.aws_sns.Topic').introducedIn).toBe('2.268.0');
  });

  test('refuses a ledger written by another fingerprint definition', () => {
    const ledger: Ledger = { ...emptyLedger(), fingerprintVersion: FINGERPRINT_VERSION + 1 };
    expect(() => updateLedger(ledger, [assembly([topic()])])).toThrow(/fingerprintVersion 2.*re-seed/);
  });

  test('a new type never also reads as changed', () => {
    const ledger = emptyLedger();
    const summary = updateLedger(ledger, [assembly([topic()])], { now: NOW });
    expect(summary.changed).toHaveLength(0);
    expect(summary.introduced).toContain('aws-cdk-lib.aws_sns.Topic');
  });
});

describe('a package documented for the first time', () => {
  function alpha(types: spec.Type[], extra: Partial<spec.Assembly> = {}): spec.Assembly {
    return assembly(types, {
      name: '@aws-cdk/aws-medialive-alpha',
      version: '2.270.0-alpha.0',
      readme: { markdown: '# MediaLive\n' },
      submodules: {},
      ...extra,
    });
  }

  function channel(overrides: Partial<spec.ClassType> = {}): spec.ClassType {
    return {
      ...topic(),
      assembly: '@aws-cdk/aws-medialive-alpha',
      fqn: '@aws-cdk/aws-medialive-alpha.Channel',
      name: 'Channel',
      namespace: undefined,
      ...overrides,
    };
  }

  /** A ledger with recorded history for one assembly, as the committed baseline has. */
  function established(): Ledger {
    const ledger = emptyLedger();
    updateLedger(ledger, [assembly([topic()])], { now: NOW });
    return ledger;
  }

  test('its types carry unknown history and are reported as seeded, not introduced', () => {
    const ledger = established();
    const summary = updateLedger(ledger, [alpha([channel()])], { now: NOW });
    expect(summary.introduced).toEqual([]);
    expect(summary.changed).toEqual([]);
    expect(summary.seeded).toContain('@aws-cdk/aws-medialive-alpha.Channel');
    expect(ledger.types['@aws-cdk/aws-medialive-alpha.Channel'])
      .toEqual([null, null, null, typeFingerprint(channel())]);
    expect(typeHistory(ledger, '@aws-cdk/aws-medialive-alpha.Channel')).toEqual({});
    expect(isAddedIn(typeHistory(ledger, '@aws-cdk/aws-medialive-alpha.Channel'), '2.270.0-alpha.0')).toBe(false);
  });

  test('its README carries unknown history', () => {
    const ledger = established();
    const summary = updateLedger(ledger, [alpha([channel()])], { now: NOW });
    expect(summary.seeded).toContain('@aws-cdk/aws-medialive-alpha');
    expect(readmeHistory(ledger, '@aws-cdk/aws-medialive-alpha')).toEqual({});
    expect(ledger.readmes['@aws-cdk/aws-medialive-alpha'][3]).toBe(readmeFingerprint('# MediaLive\n'));
  });

  test('a type added to it later is introduced in the installed release', () => {
    const ledger = established();
    updateLedger(ledger, [alpha([channel()])], { now: NOW });
    const input: spec.ClassType = { ...channel(), fqn: '@aws-cdk/aws-medialive-alpha.Input', name: 'Input' };
    const summary = updateLedger(ledger, [alpha([channel(), input], { version: '2.271.0-alpha.0' })], { now: NOW });
    expect(summary.seeded).toEqual([]);
    expect(summary.introduced).toEqual(['@aws-cdk/aws-medialive-alpha.Input']);
    expect(typeHistory(ledger, '@aws-cdk/aws-medialive-alpha.Input').introducedIn).toBe('2.271.0-alpha.0');
  });

  test('a shape change in a seeded type is dated, with introduction still unknown', () => {
    const ledger = established();
    updateLedger(ledger, [alpha([channel()])], { now: NOW });
    const summary = updateLedger(ledger, [alpha([channel({ base: 'aws-cdk-lib.Construct' })], { version: '2.271.0-alpha.0' })], { now: NOW });
    expect(summary.changed).toEqual(['@aws-cdk/aws-medialive-alpha.Channel']);
    expect(typeHistory(ledger, '@aws-cdk/aws-medialive-alpha.Channel')).toEqual({
      lastChangedIn: '2.271.0-alpha.0',
      lastChangedAt: '2026-09-11T06:00:00.000Z',
    });
  });

  test('a submodule of an already documented assembly is introduced, not seeded', () => {
    const ledger = established();
    const withNew = assembly([topic()], {
      version: '2.269.0',
      submodules: { 'aws-cdk-lib.aws_sns': { readme: { markdown: '# SNS\n' } }, 'aws-cdk-lib.aws_new': { readme: { markdown: '# New\n' } } },
    });
    const summary = updateLedger(ledger, [withNew], { now: NOW });
    expect(summary.seeded).toEqual([]);
    expect(summary.introduced).toEqual(['aws-cdk-lib.aws_new']);
  });

  test('the first update of an empty ledger introduces everything rather than seeding it', () => {
    const ledger = emptyLedger();
    const summary = updateLedger(ledger, [assembly([topic()]), alpha([channel()])], { now: NOW });
    expect(summary.seeded).toEqual([]);
    expect(summary.introduced).toContain('@aws-cdk/aws-medialive-alpha.Channel');
    expect(typeHistory(ledger, '@aws-cdk/aws-medialive-alpha.Channel').introducedIn).toBe('2.270.0-alpha.0');
  });
});

describe('migration from the flat FQN baseline', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function legacy(fqns: string[]): string {
    const file = join(dir, 'docgen.baseline.json');
    writeFileSync(file, JSON.stringify({ assemblies: { 'aws-cdk-lib': { version: '2.267.0', types: fqns } } }));
    return file;
  }

  /** Round-trip through the file, as the nightly's next run would read it. */
  function persist(ledger: Ledger): string {
    const file = join(dir, 'persisted.json');
    writeLedger(file, ledger);
    return file;
  }

  test('a flat baseline reads as migrated; a ledger does not', () => {
    const loaded = readLedger(legacy(['aws-cdk-lib.aws_sns.Topic']))!;
    expect(loaded.migrated).toBe(true);
    expect(loaded.ledger.fingerprintVersion).toBe(FINGERPRINT_VERSION);
    expect(loaded.ledger.types['aws-cdk-lib.aws_sns.Topic']).toEqual([null, null, null, '']);
    const file = join(dir, 'ledger.json');
    writeLedger(file, loaded.ledger);
    expect(readLedger(file)!.migrated).toBe(false);
  });

  test('listed types get unknown history; unlisted types are introduced; READMEs are unknown', () => {
    const { ledger, migrated } = readLedger(legacy(['aws-cdk-lib.aws_sns.Topic']))!;
    const fresh: spec.ClassType = { ...topic(), fqn: 'aws-cdk-lib.aws_sns.Fresh', name: 'Fresh' };
    const summary = updateLedger(ledger, [assembly([topic(), fresh])], { now: NOW, migrating: migrated });
    expect(summary.introduced).toEqual(['aws-cdk-lib.aws_sns.Fresh']);
    expect(summary.changed).toEqual([]);
    expect(typeHistory(ledger, 'aws-cdk-lib.aws_sns.Topic')).toEqual({});
    expect(ledger.types['aws-cdk-lib.aws_sns.Topic'][3]).toBe(typeFingerprint(topic()));
    expect(typeHistory(ledger, 'aws-cdk-lib.aws_sns.Fresh').introducedIn).toBe('2.268.0');
    expect(readmeHistory(ledger, 'aws-cdk-lib.aws_sns')).toEqual({});
    expect(ledger.readmes['aws-cdk-lib.aws_sns'][3]).toBe(readmeFingerprint('# SNS\n'));
  });

  test('after migration a README first seen is introduced normally, even with a stranded row', () => {
    // `Gone` was listed in the flat baseline but is no longer installed, so its fingerprint stays empty forever;
    // that must not make every later update look like the migration.
    const { ledger, migrated } = readLedger(legacy(['aws-cdk-lib.aws_sns.Topic', 'aws-cdk-lib.aws_sns.Gone']))!;
    updateLedger(ledger, [assembly([topic()])], { now: NOW, migrating: migrated });
    expect(ledger.types['aws-cdk-lib.aws_sns.Gone']).toEqual([null, null, null, '']);
    const withNew = assembly([topic()], {
      version: '2.269.0',
      submodules: { 'aws-cdk-lib.aws_sns': { readme: { markdown: '# SNS\n' } }, 'aws-cdk-lib.aws_new': { readme: { markdown: '# New\n' } } },
    });
    const summary = updateLedger(ledger, [withNew], { now: NOW, migrating: readLedger(persist(ledger))!.migrated });
    expect(summary.introduced).toEqual(['aws-cdk-lib.aws_new']);
    expect(readmeHistory(ledger, 'aws-cdk-lib.aws_new')).toEqual({
      introducedIn: '2.269.0',
      lastChangedIn: '2.269.0',
      lastChangedAt: '2026-09-11T06:00:00.000Z',
    });
  });

  test('a README first seen on a non-migrating update of a fresh ledger is introduced', () => {
    const ledger = emptyLedger();
    const summary = updateLedger(ledger, [assembly([topic()])], { now: NOW });
    expect(summary.introduced).toEqual(['aws-cdk-lib.aws_sns.Topic', 'aws-cdk-lib', 'aws-cdk-lib.aws_sns']);
  });

  test('a migrated row whose shape then changes is dated from the change, with introduction still unknown', () => {
    const { ledger, migrated } = readLedger(legacy(['aws-cdk-lib.aws_sns.Topic']))!;
    updateLedger(ledger, [assembly([topic()])], { now: NOW, migrating: migrated });
    const changed = topic({ base: 'aws-cdk-lib.Construct' });
    updateLedger(ledger, [assembly([changed], { version: '2.269.0' })], { now: NOW });
    expect(typeHistory(ledger, 'aws-cdk-lib.aws_sns.Topic')).toEqual({
      lastChangedIn: '2.269.0',
      lastChangedAt: '2026-09-11T06:00:00.000Z',
    });
  });
});

describe('ledger file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('round-trips, one row per line, keys sorted', () => {
    const ledger = emptyLedger();
    updateLedger(ledger, [assembly([topic()])], { now: NOW });
    const file = join(dir, 'ledger.json');
    writeLedger(file, ledger);
    const text = readFileSync(file, 'utf-8');
    expect(text.split('\n').filter((l) => /^    "[^"]+": \[/.test(l))).toHaveLength(3);
    expect(text.indexOf('"aws-cdk-lib"')).toBeLessThan(text.indexOf('"aws-cdk-lib.aws_sns"'));
    expect(loadLedger(file)).toEqual(JSON.parse(JSON.stringify(ledger)));
  });

  test('returns undefined for a missing file and rejects a malformed one', () => {
    expect(loadLedger(join(dir, 'nope.json'))).toBeUndefined();
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{"fingerprintVersion":1,"versions":[],"types":{}}');
    expect(() => loadLedger(file)).toThrow(/"readmes" must be an object/);
    writeFileSync(file, '{"versions":[],"types":{},"readmes":{}}');
    expect(() => loadLedger(file)).toThrow(/"fingerprintVersion" must be a number/);
  });

  test('checked-in ledger loads and covers the documented corpus', () => {
    const ledger = loadLedger(join(import.meta.dirname, '..', 'docgen.baseline.json'))!;
    expect(Object.keys(ledger.types).length).toBeGreaterThan(20000);
    expect(Object.keys(ledger.readmes).length).toBeGreaterThan(300);
  });
});

describe('unknowns and the Added-in rule', () => {
  test('an unknown history renders nothing', () => {
    const ledger = emptyLedger();
    expect(typeHistory(ledger, 'nope')).toEqual({});
    expect(typeHistory(undefined, 'nope')).toEqual({});
    expect(readmeHistory(undefined, 'nope')).toEqual({});
  });

  test('isAddedIn compares major.minor only and never fires on unknown', () => {
    expect(isAddedIn({ introducedIn: '2.268.0' }, '2.268.3')).toBe(true);
    expect(isAddedIn({ introducedIn: '2.268.0-alpha.0' }, '2.268.0')).toBe(true);
    expect(isAddedIn({ introducedIn: '2.267.0' }, '2.268.0')).toBe(false);
    expect(isAddedIn({}, '2.268.0')).toBe(false);
  });
});
