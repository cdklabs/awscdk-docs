import { gzipSync } from 'zlib';
import * as spec from '@jsii/spec';
import {
  assemblyFromTarball,
  BackfillRelease,
  downloadAssembly,
  mergeSeedLedger,
  seedHistoryLedger,
  selectReleaseWindow,
} from '../src/docgen/history-backfill.js';
import { Ledger, readmeHistory, typeHistory } from '../src/docgen/history.js';

function topic(version: string, propertyName = 'topicArn'): spec.Assembly {
  const type: spec.ClassType = {
    assembly: 'aws-cdk-lib',
    fqn: 'aws-cdk-lib.aws_sns.Topic',
    kind: spec.TypeKind.Class,
    name: 'Topic',
    properties: [{ name: propertyName, type: { primitive: spec.PrimitiveType.String } }],
  };
  return {
    schema: spec.SchemaVersion.LATEST,
    name: 'aws-cdk-lib',
    version,
    fingerprint: 'x',
    jsiiVersion: '5',
    license: 'Apache-2.0',
    homepage: 'h',
    repository: { type: 'git', url: 'u' },
    author: { name: 'a', roles: [] },
    description: 'd',
    types: { [type.fqn]: type },
    readme: { markdown: version === '2.2.0' ? '# New readme\n' : '# README\n' },
  };
}

function release(version: string): BackfillRelease {
  return { version, publishedAt: `2026-01-0${version[2]}T00:00:00.000Z`, tarball: `https://example/${version}` };
}

function tarball(name: string, body: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return gzipSync(Buffer.concat([header, body, padding, Buffer.alloc(1024)]));
}

describe('selectReleaseWindow', () => {
  test('selects stable releases oldest to newest and ends at the pinned target', () => {
    const versions = Object.fromEntries(['2.0.0', '2.1.0', '2.1.1-alpha.0', '2.2.0', '3.0.0']
      .map((version) => [version, { dist: { tarball: `https://example/${version}` } }]));
    const time = Object.fromEntries(Object.keys(versions).map((version) => [version, `${version}Z`]));
    expect(selectReleaseWindow({ versions, time }, '2.2.0', 2).map((entry) => entry.version)).toEqual(['2.1.0', '2.2.0']);
  });

  test('rejects a target absent from the packument', () => {
    expect(() => selectReleaseWindow({ versions: {}, time: {} }, '2.2.0', 50)).toThrow(/target 2.2.0/);
  });
});

describe('assemblyFromTarball', () => {
  test.each(['package/.jsii', 'package/.jsii.gz'])('extracts %s without installing the package', (path) => {
    const assembly = topic('2.2.0');
    const json = Buffer.from(JSON.stringify(assembly));
    const body = path.endsWith('.gz') ? gzipSync(json) : json;
    expect(assemblyFromTarball(tarball(path, body)).version).toBe('2.2.0');
  });
});

describe('downloadAssembly', () => {
  const registryRelease = (value: string): BackfillRelease => ({
    version: '2.2.0',
    publishedAt: '2026-01-02T00:00:00.000Z',
    tarball: value,
  });
  const valid = 'https://registry.npmjs.org/aws-cdk-lib/-/aws-cdk-lib-2.2.0.tgz';

  test('downloads a registry tarball without following redirects', async () => {
    const body = tarball('package/.jsii', Buffer.from(JSON.stringify(topic('2.2.0'))));
    const calls: Array<[string, RequestInit | undefined]> = [];
    const get = (async (input: unknown, init?: RequestInit) => {
      calls.push([String(input), init]);
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    await expect(downloadAssembly(registryRelease(valid), get)).resolves.toMatchObject({ version: '2.2.0' });
    expect(calls).toEqual([[valid, { redirect: 'error' }]]);
  });

  test.each([
    ['http://registry.npmjs.org/aws-cdk-lib/-/aws-cdk-lib-2.2.0.tgz', /non-HTTPS tarball URL/],
    ['https://registry.example.com/aws-cdk-lib-2.2.0.tgz', /outside https:\/\/registry\.npmjs\.org/],
    ['//registry.npmjs.org/aws-cdk-lib-2.2.0.tgz', /unparsable tarball URL/],
    ['aws-cdk-lib-2.2.0.tgz', /unparsable tarball URL/],
  ])('refuses %s before requesting it', async (value, message) => {
    const get = (async () => {
      throw new Error('no request expected');
    }) as typeof fetch;

    await expect(downloadAssembly(registryRelease(value), get)).rejects.toThrow(message);
  });

  test('reports the release when the request is refused for redirecting', async () => {
    const get = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    await expect(downloadAssembly(registryRelease(valid), get))
      .rejects.toThrow(/failed to download aws-cdk-lib 2\.2\.0 from .*aws-cdk-lib-2\.2\.0\.tgz: fetch failed/);
  });
});

describe('seedHistoryLedger', () => {
  test('keeps the window boundary unknown and dates later introductions and changes', async () => {
    const releases = [release('2.1.0'), release('2.2.0')];
    const added: spec.ClassType = {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_sns.Fresh',
      kind: spec.TypeKind.Class,
      name: 'Fresh',
    };
    const assemblies = [topic('2.1.0'), {
      ...topic('2.2.0', 'topicName'),
      types: { ...topic('2.2.0', 'topicName').types, [added.fqn]: added },
    }];
    const result = await seedHistoryLedger(releases, async (entry) => assemblies[releases.indexOf(entry)]);

    expect(typeHistory(result.ledger, 'aws-cdk-lib.aws_sns.Topic')).toEqual({
      lastChangedIn: '2.2.0',
      lastChangedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(typeHistory(result.ledger, added.fqn)).toEqual({
      introducedIn: '2.2.0',
      lastChangedIn: '2.2.0',
      lastChangedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(readmeHistory(result.ledger, 'aws-cdk-lib')).toEqual({
      lastChangedIn: '2.2.0',
      lastChangedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.coverage).toMatchObject({ currentTypes: 2, introducedTypes: 1, changedTypes: 2 });
  });

  test('leaves unchanged entries from the oldest release entirely unknown', async () => {
    const releases = [release('2.1.0'), release('2.2.0')];
    const result = await seedHistoryLedger(releases, async (entry) => topic(entry.version));
    expect(typeHistory(result.ledger, 'aws-cdk-lib.aws_sns.Topic')).toEqual({});
    expect(readmeHistory(result.ledger, 'aws-cdk-lib')).toEqual({ lastChangedIn: '2.2.0', lastChangedAt: '2026-01-02T00:00:00.000Z' });
  });
});


describe('mergeSeedLedger', () => {
  test('replaces aws-cdk-lib history and preserves other assemblies with remapped versions', async () => {
    const releases = [release('2.1.0'), release('2.2.0')];
    const seed = (await seedHistoryLedger(releases, async (entry) => topic(entry.version))).ledger;
    const existing: Ledger = {
      fingerprintVersion: seed.fingerprintVersion,
      versions: ['2.2.0-alpha.0'],
      types: {
        '@aws-cdk/example-alpha.Widget': [0, 0, '2026-01-02T01:00:00.000Z', 'abc123abc123'],
        'aws-cdk-lib.Old': [null, null, null, 'def456def456'],
      },
      readmes: {
        '@aws-cdk/example-alpha': [null, null, null, '123abc123abc'],
        'aws-cdk-lib': [null, null, null, '456def456def'],
      },
    };
    const merged = mergeSeedLedger(seed, existing);

    expect(merged.types['aws-cdk-lib.Old']).toBeUndefined();
    expect(merged.readmes['aws-cdk-lib'][3]).toBe(seed.readmes['aws-cdk-lib'][3]);
    expect(typeHistory(merged, '@aws-cdk/example-alpha.Widget')).toEqual({
      introducedIn: '2.2.0-alpha.0',
      lastChangedIn: '2.2.0-alpha.0',
      lastChangedAt: '2026-01-02T01:00:00.000Z',
    });
    expect(merged.readmes['@aws-cdk/example-alpha']).toEqual([null, null, null, '123abc123abc']);
  });
});
