import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  CDK_DIST_DIR_ENV,
} from '../src/docgen/dist.js';
import {
  absoluteDocsUrl,
  buildVersionsData,
  buildVersionsJson,
  CDK_V1,
  compareVersionsDesc,
  DEFAULT_DOCS_SITE_URL,
  docsSiteUrl,
  DOCUMENTED_PACKAGE,
  isStableVersion,
  loadVersionsData,
  overlayDistVersion,
  packageVersions,
  Packument,
  readVersionSnapshot,
  releaseUrl,
  siteApiDocsUrl,
  snapshotPackuments,
  TRACKED_PACKAGES,
  VERSION_SNAPSHOT_FILE,
  VERSIONS_JSON_PATH,
  writeVersionsJson,
  writeVersionSnapshot,
} from '../src/docgen/versions.js';

const ROOT = resolve(import.meta.dirname, '..');

function fixturePackument(latest: string, time: Record<string, string>): Packument {
  return { 'dist-tags': { latest }, time };
}

const CDK_LIB = TRACKED_PACKAGES[0];
const CDK_CLI = TRACKED_PACKAGES[1];

describe('tracked packages', () => {
  test('covers the four core CDK ecosystem packages', () => {
    expect(TRACKED_PACKAGES.map((p) => p.name)).toEqual([
      'aws-cdk-lib',
      'aws-cdk',
      '@aws-cdk/toolkit-lib',
      '@aws-cdk/cloud-assembly-schema',
    ]);
  });

  test('labels read as the official product names', () => {
    // Pinned by package name, not by table position, so a future edit
    // cannot revert one label while the list still parses.
    expect(Object.fromEntries(TRACKED_PACKAGES.map((p) => [p.name, p.label]))).toEqual({
      'aws-cdk-lib': 'AWS Construct Library',
      'aws-cdk': 'AWS CDK Toolkit CLI',
      '@aws-cdk/toolkit-lib': 'AWS CDK Toolkit Library',
      '@aws-cdk/cloud-assembly-schema': 'Cloud Assembly Schema',
    });
  });
});

describe('docs links', () => {
  test('every tracked package declares a docs URL', () => {
    for (const pkg of TRACKED_PACKAGES) {
      expect(pkg.docsUrl.length).toBeGreaterThan(0);
    }
  });

  test('aws-cdk-lib links to this site, base-agnostic, in the default language', () => {
    // Site-relative (leading '/'): the page applies withBase at render
    // time, so the stored path must not bake in the deploy base.
    expect(CDK_LIB.docsUrl).toBe('/v2/docs/aws-cdk-lib-readme.html');
    expect(CDK_LIB.docsUrl).toBe(siteApiDocsUrl('aws-cdk-lib'));
  });

  test('siteApiDocsUrl slugifies scoped package names', () => {
    expect(siteApiDocsUrl('@aws-cdk/toolkit-lib')).toBe('/v2/docs/@aws-cdk_toolkit-lib-readme.html');
  });

  test('external docs links are absolute https URLs', () => {
    for (const pkg of TRACKED_PACKAGES.filter((p) => p.name !== 'aws-cdk-lib')) {
      expect(pkg.docsUrl).toMatch(/^https:\/\//);
    }
  });

  test('packageVersions carries the docs URL through to the page data', () => {
    const packument = fixturePackument('2.264.0', { '2.264.0': '2026-08-07T10:00:00.000Z' });
    expect(packageVersions(CDK_LIB, packument).docsUrl).toBe(CDK_LIB.docsUrl);
    // Major-only packages take the majorOnlyPackageVersions path.
    const schema = TRACKED_PACKAGES[3];
    const schemaPackument = fixturePackument('45.6.2', { '45.6.2': '2026-08-07T10:00:00.000Z' });
    expect(packageVersions(schema, schemaPackument).docsUrl).toBe(schema.docsUrl);
  });
});

describe('release URLs', () => {
  test('aws-cdk-lib links to aws/aws-cdk releases tagged v<version>', () => {
    expect(releaseUrl(CDK_LIB, '2.264.0')).toBe(
      'https://github.com/aws/aws-cdk/releases/tag/v2.264.0',
    );
  });

  test('CLI-monorepo packages link to aws/aws-cdk-cli tagged <pkg>@v<version>', () => {
    expect(releaseUrl(CDK_CLI, '2.1136.0')).toBe(
      'https://github.com/aws/aws-cdk-cli/releases/tag/aws-cdk%40v2.1136.0',
    );
    const schema = TRACKED_PACKAGES[3];
    expect(releaseUrl(schema, '54.18.0')).toBe(
      'https://github.com/aws/aws-cdk-cli/releases/tag/%40aws-cdk%2Fcloud-assembly-schema%40v54.18.0',
    );
  });
});

describe('version ordering and filtering', () => {
  test('isStableVersion rejects pre-releases and registry bookkeeping keys', () => {
    expect(isStableVersion('2.264.0')).toBe(true);
    expect(isStableVersion('2.264.0-alpha.1')).toBe(false);
    expect(isStableVersion('created')).toBe(false);
    expect(isStableVersion('modified')).toBe(false);
  });

  test('compareVersionsDesc sorts numerically, not lexically', () => {
    expect(['2.9.0', '2.10.0', '2.264.0'].sort(compareVersionsDesc)).toEqual([
      '2.264.0',
      '2.10.0',
      '2.9.0',
    ]);
  });

  test('compareVersionsDesc orders a pre-release as the release it precedes', () => {
    expect(compareVersionsDesc('2.268.1', '2.268.2-rc.0')).toBeGreaterThan(0);
    expect(compareVersionsDesc('2.268.2', '2.268.2-rc.0')).toBe(0);
    expect(compareVersionsDesc('2.268.3', '2.268.2-rc.0')).toBeLessThan(0);
  });
});

describe('packageVersions', () => {
  const packument = fixturePackument('2.264.0', {
    'created': '2021-01-01T00:00:00.000Z',
    'modified': '2026-08-12T00:00:00.000Z',
    '2.262.2': '2026-07-29T10:00:00.000Z',
    '2.263.0': '2026-08-01T10:00:00.000Z',
    '2.264.0-alpha.0': '2026-08-05T10:00:00.000Z',
    '2.264.0': '2026-08-07T10:00:00.000Z',
  });

  const result = packageVersions(CDK_LIB, packument);

  test('current release comes from the latest dist-tag with its publish date', () => {
    expect(result.current.version).toBe('2.264.0');
    expect(result.current.releaseDate).toBe('2026-08-07');
    expect(result.current.releaseUrl).toBe(
      'https://github.com/aws/aws-cdk/releases/tag/v2.264.0',
    );
  });

  test('only the current release is resolved — no previous-releases list', () => {
    expect(Object.keys(result).sort()).toEqual(['current', 'docsUrl', 'label', 'name']);
    expect(result).not.toHaveProperty('previous');
  });

  test('pre-releases never appear', () => {
    expect(result.current.version).not.toBe('2.264.0-alpha.0');
  });

  test('missing publish timestamp yields an empty release date, not a crash', () => {
    const sparse = packageVersions(CDK_LIB, fixturePackument('9.9.9', {}));
    expect(sparse.current.releaseDate).toBe('');
  });
});

describe('major-only packages', () => {
  const SCHEMA = TRACKED_PACKAGES[3];

  test('only the Cloud Assembly Schema is major-only', () => {
    expect(TRACKED_PACKAGES.filter((p) => p.majorOnly).map((p) => p.name)).toEqual([
      '@aws-cdk/cloud-assembly-schema',
    ]);
  });

  const packument = fixturePackument('45.6.2', {
    'created': '2021-01-01T00:00:00.000Z',
    'modified': '2026-08-12T00:00:00.000Z',
    '43.0.0': '2026-05-01T10:00:00.000Z',
    '43.1.4': '2026-05-20T10:00:00.000Z',
    '44.0.0': '2026-06-01T10:00:00.000Z',
    '44.3.1': '2026-06-25T10:00:00.000Z',
    '45.0.0': '2026-07-01T10:00:00.000Z',
    '45.6.1': '2026-08-01T10:00:00.000Z',
    '45.6.2': '2026-08-07T10:00:00.000Z',
    '45.7.0-alpha.0': '2026-08-08T10:00:00.000Z',
  });

  const result = packageVersions(SCHEMA, packument);

  test('current version shows the major only', () => {
    expect(result.current.version).toBe('45');
  });

  test('current major links to its latest minor/patch release with that date', () => {
    expect(result.current.releaseUrl).toBe(
      'https://github.com/aws/aws-cdk-cli/releases/tag/%40aws-cdk%2Fcloud-assembly-schema%40v45.6.2',
    );
    expect(result.current.releaseDate).toBe('2026-08-07');
  });

  test('the result carries no prior-major entry', () => {
    expect(result).not.toHaveProperty('previous');
  });

  test('pre-releases never influence the major mapping', () => {
    expect(result.current.releaseUrl).not.toContain('45.7.0');
  });

  test('a packument without stable timestamps falls back to the latest dist-tag', () => {
    const sparse = packageVersions(SCHEMA, fixturePackument('9.9.9', {}));
    expect(sparse.current.version).toBe('9');
    expect(sparse.current.releaseUrl).toContain('v9.9.9');
  });
});

describe('loadVersionsData', () => {
  test('reads the committed snapshot, emits versions.json, and never touches the network', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snapshot-'));
    const file = join(dir, VERSION_SNAPSHOT_FILE);
    const publicDir = join(dir, 'public');
    try {
      writeVersionSnapshot(
        {
          generatedAt: '2026-09-01T12:00:00.000Z',
          packages: Object.fromEntries(
            TRACKED_PACKAGES.map((p) => [p.name, fixturePackument('1.0.0', { '1.0.0': '2026-08-01T00:00:00.000Z' })]),
          ),
        },
        file,
      );
      const data = loadVersionsData(file, publicDir);

      // Tracked packages plus the static v1 entry — never fetched.
      expect(data.packages.map((p) => p.name)).toEqual([
        ...TRACKED_PACKAGES.map((p) => p.name),
        CDK_V1.package,
      ]);

      // Reproducibility, pinned on the shipped path: the timestamp is the
      // snapshot's, not the clock's, in BOTH outputs — so two builds of one
      // commit render identical HTML data and an identical endpoint.
      expect(data.generatedAt).toBe('2026-09-01T12:00:00.000Z');
      const emitted = readFileSync(join(publicDir, VERSIONS_JSON_PATH), 'utf-8');
      expect(JSON.parse(emitted).generatedAt).toBe('2026-09-01T12:00:00.000Z');

      expect(loadVersionsData(file, publicDir)).toEqual(data);
      expect(readFileSync(join(publicDir, VERSIONS_JSON_PATH), 'utf-8')).toBe(emitted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing packument fails the build loudly', () => {
    expect(() => buildVersionsData(new Map())).toThrow(/missing packument for aws-cdk-lib/);
  });
});

describe('candidate builds report the candidate version', () => {
  const COMMITTED = '1.0.0';
  const CANDIDATE = '2.269.0';
  const RC_CANDIDATE = '2.269.0-rc.0';

  function snapshotFile(dir: string): string {
    const file = join(dir, VERSION_SNAPSHOT_FILE);
    writeVersionSnapshot(
      {
        generatedAt: '2026-09-01T12:00:00.000Z',
        packages: Object.fromEntries(
          TRACKED_PACKAGES.map((p) => [
            p.name,
            fixturePackument(COMMITTED, { [COMMITTED]: '2026-08-01T00:00:00.000Z' }),
          ]),
        ),
      },
      file,
    );
    return file;
  }

  test('the overlay moves only the documented package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-overlay-'));
    try {
      const snapshot = readVersionSnapshot(snapshotFile(dir));
      const overlaid = overlayDistVersion(snapshot, CANDIDATE);

      expect(overlaid.packages[DOCUMENTED_PACKAGE]['dist-tags'].latest).toBe(CANDIDATE);
      for (const pkg of TRACKED_PACKAGES.filter((p) => p.name !== DOCUMENTED_PACKAGE)) {
        expect(overlaid.packages[pkg.name]['dist-tags'].latest).toBe(COMMITTED);
      }
      // The committed snapshot is left alone — the overlay is a build-time view, not an edit.
      expect(snapshot.packages[DOCUMENTED_PACKAGE]['dist-tags'].latest).toBe(COMMITTED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no publish date is invented for a version npm has never seen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-overlay-'));
    try {
      const overlaid = overlayDistVersion(readVersionSnapshot(snapshotFile(dir)), CANDIDATE);
      expect(overlaid.packages[DOCUMENTED_PACKAGE].time[CANDIDATE]).toBeUndefined();

      const entry = buildVersionsJson(snapshotPackuments(overlaid)).packages.find(
        (p) => p.package === DOCUMENTED_PACKAGE,
      );
      expect(entry).toMatchObject({ version: CANDIDATE, date: '' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the shape the pipeline delivers, a candidate carrying its own prerelease identifier', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-overlay-'));
    try {
      const overlaid = overlayDistVersion(readVersionSnapshot(snapshotFile(dir)), RC_CANDIDATE);
      const entry = buildVersionsJson(snapshotPackuments(overlaid)).packages.find(
        (p) => p.package === DOCUMENTED_PACKAGE,
      );
      expect(entry).toMatchObject({ version: RC_CANDIDATE, date: '' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a candidate version that is not a semver version is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-overlay-'));
    try {
      const snapshot = readVersionSnapshot(snapshotFile(dir));
      expect(() => overlayDistVersion(snapshot, 'v2.269')).toThrow(/must be a semver version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the shipped path reports the candidate in versions.json, the S3-key contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-load-'));
    const publicDir = join(dir, 'public');
    const distDir = join(dir, 'dist');
    try {
      const file = snapshotFile(dir);
      mkdirSync(distDir, { recursive: true });
      writeFileSync(join(distDir, 'build.json'), JSON.stringify({ version: CANDIDATE }));

      process.env[CDK_DIST_DIR_ENV] = distDir;
      const data = loadVersionsData(file, publicDir);
      delete process.env[CDK_DIST_DIR_ENV];

      const documented = data.packages.find((p) => p.name === DOCUMENTED_PACKAGE);
      expect(documented?.current).toMatchObject({ version: CANDIDATE, releaseDate: '' });
      const emitted = JSON.parse(readFileSync(join(publicDir, VERSIONS_JSON_PATH), 'utf-8'));
      expect(emitted.packages).toContainEqual(
        expect.objectContaining({ package: DOCUMENTED_PACKAGE, version: CANDIDATE }),
      );
    } finally {
      delete process.env[CDK_DIST_DIR_ENV];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('without the variable the output is identical to today', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-off-'));
    const publicDir = join(dir, 'public');
    try {
      delete process.env[CDK_DIST_DIR_ENV];
      const data = loadVersionsData(snapshotFile(dir), publicDir);
      expect(
        data.packages.find((p) => p.name === DOCUMENTED_PACKAGE)?.current.version,
      ).toBe(COMMITTED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('versions page wiring', () => {
  const page = readFileSync(resolve(ROOT, 'docs/versions.md'), 'utf-8');
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');

  test('the data loader is a shim over the tested function, not a second copy of it', () => {
    const loader = readFileSync(resolve(ROOT, 'docs/versions.data.ts'), 'utf-8');
    expect(loader).toContain("from '../src/docgen/versions'");
    // One tested function owns the whole build-time path, so the
    // shipped path cannot diverge from the asserted one — and the build
    // performs no registry call.
    expect(loader).toContain('return loadVersionsData(');
    expect(loader).not.toContain('fetchPackuments');
    expect(loader).not.toContain('new Date()');
    expect(loader).not.toContain('buildVersionsData');
    expect(loader).not.toContain('buildVersionsJson');
  });

  test('page consumes the data loader and uses accessible table markup', () => {
    expect(page).toContain("import { data } from './versions.data'");
    expect(page).toContain('<thead>');
    expect(page).toContain('<th scope="col">');
    expect(page).toContain('<th scope="row">');
  });

  test('page shows release dates and links per package', () => {
    expect(page).toContain('pkg.current.releaseDate');
    expect(page).toContain('pkg.current.releaseUrl');
  });

  test('the table is Package / Current version / Released, with no previous-releases column', () => {
    expect(page.match(/<th scope="col">/g)).toHaveLength(3);
    expect(page).toContain('<th scope="col">Current version</th>');
    expect(page).toContain('<th scope="col">Released</th>');
    expect(page).not.toContain('Previous releases');
    expect(page).not.toContain('pkg.previous');
  });

  test('the copy links the JSON endpoint base-aware and dates the v1 end of support', () => {
    expect(page).toContain('Download version information as JSON');
    expect(page).toContain('withBase(`/${VERSIONS_JSON_PATH}`)');
    expect(page).not.toMatch(/href="\/versions\.json"/);
    expect(page).toContain('end-of-support since {{ data.v1EndOfSupport }}');
    expect(page).toContain('release notes, docs and');
  });

  test('page renders a base-aware docs link per package', () => {
    expect(page).toContain('pkg.docsUrl');
    // Internal (site-relative) docs links must honor the VitePress base.
    expect(page).toContain('withBase');
    expect(page).toContain("import { withBase } from 'vitepress'");
  });

  test('versions page is in the top-level navbar', () => {
    expect(config).toContain('{ text: "Versions", link: VERSIONS_ROUTE }');
  });

});

describe('versions.json endpoint', () => {
  const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

  function allPackuments(): Map<string, Packument> {
    const packuments = new Map<string, Packument>();
    packuments.set('aws-cdk-lib', fixturePackument('2.264.0', {
      '2.264.0': '2026-08-07T10:00:00.000Z',
    }));
    packuments.set('aws-cdk', fixturePackument('2.1136.0', {
      '2.1136.0': '2026-08-06T09:00:00.000Z',
    }));
    packuments.set('@aws-cdk/toolkit-lib', fixturePackument('1.5.0', {
      '1.5.0': '2026-08-05T08:00:00.000Z',
    }));
    packuments.set('@aws-cdk/cloud-assembly-schema', fixturePackument('45.6.2', {
      '45.6.2': '2026-08-07T10:00:00.000Z',
    }));
    return packuments;
  }

  const json = buildVersionsJson(allPackuments(), new Date('2026-08-18T20:00:00.000Z'));

  test('one entry per tracked package plus the static v1 entry, each with package, version, date, releaseUrl and docsUrl keys', () => {
    expect(json.packages.map((e) => e.package)).toEqual([
      ...TRACKED_PACKAGES.map((p) => p.name),
      CDK_V1.package,
    ]);
    for (const entry of json.packages) {
      expect(Object.keys(entry).sort()).toEqual(['date', 'docsUrl', 'package', 'releaseUrl', 'version']);
    }
  });

  test('every entry links its release notes, and a live package matches what the HTML page links', () => {
    for (const entry of json.packages) {
      expect(entry.releaseUrl).toMatch(/^https:\/\/github\.com\//);
    }
    // Same URL the page's "current version" column renders, for the same
    // version — the two surfaces are built from one function, not two.
    const page = buildVersionsData(allPackuments(), new Date('2026-08-18T20:00:00.000Z'));
    for (const pkg of TRACKED_PACKAGES.filter((p) => !p.majorOnly)) {
      const entry = json.packages.find((e) => e.package === pkg.name)!;
      const row = page.packages.find((p) => p.name === pkg.name)!;
      expect(entry.releaseUrl).toBe(row.current.releaseUrl);
    }
    const lib = json.packages.find((e) => e.package === 'aws-cdk-lib')!;
    expect(lib.releaseUrl).toBe('https://github.com/aws/aws-cdk/releases/tag/v2.264.0');
    // A major-only package points at the full version it reports, not the major.
    const schema = json.packages.find((e) => e.package === '@aws-cdk/cloud-assembly-schema')!;
    expect(schema.releaseUrl).toBe(releaseUrl(TRACKED_PACKAGES[3], schema.version));
  });

  test('every docs URL is absolute; site-relative page links resolve against the default site prefix', () => {
    for (const entry of json.packages) {
      expect(entry.docsUrl).toMatch(/^https:\/\//);
    }
    for (const pkg of TRACKED_PACKAGES) {
      const entry = json.packages.find((e) => e.package === pkg.name)!;
      if (pkg.docsUrl.startsWith('/')) {
        expect(entry.docsUrl).toBe(`${DEFAULT_DOCS_SITE_URL}${pkg.docsUrl.slice(1)}`);
      } else {
        // Already-absolute entries pass through byte-identical.
        expect(entry.docsUrl).toBe(pkg.docsUrl);
      }
    }
    // The concrete case the issue reports: no double slash, full URL.
    const lib = json.packages.find((e) => e.package === 'aws-cdk-lib')!;
    expect(lib.docsUrl).toBe('https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib-readme.html');
  });

  test('the site prefix is overridable via DOCS_SITE_URL, and a missing trailing slash still joins cleanly', () => {
    // The resolver reads the override per call, so passing it explicitly
    // covers the same seam the env var feeds.
    expect(absoluteDocsUrl('/v2/docs/aws-cdk-lib-readme.html', 'https://example.com/cdk/'))
      .toBe('https://example.com/cdk/v2/docs/aws-cdk-lib-readme.html');
    expect(absoluteDocsUrl('/v2/docs/aws-cdk-lib-readme.html', 'https://example.com/cdk'))
      .toBe('https://example.com/cdk/v2/docs/aws-cdk-lib-readme.html');
    // Absolute URLs never touch the prefix.
    expect(absoluteDocsUrl('https://docs.aws.amazon.com/cdk/api/v1/', 'https://example.com/cdk/'))
      .toBe('https://docs.aws.amazon.com/cdk/api/v1/');
    // The default lives in one exported constant.
    expect(DEFAULT_DOCS_SITE_URL).toBe('https://docs.aws.amazon.com/cdk/api/');
    expect(absoluteDocsUrl('/versions.html'))
      .toBe(`${DEFAULT_DOCS_SITE_URL}versions.html`);
  });

  test('docsSiteUrl is the override or the default, always directory-shaped', () => {
    expect(docsSiteUrl({})).toBe(DEFAULT_DOCS_SITE_URL);
    expect(docsSiteUrl({ DOCS_SITE_URL: 'https://example.com/preview' })).toBe('https://example.com/preview/');
    expect(docsSiteUrl({ DOCS_SITE_URL: 'https://example.com/preview/' })).toBe('https://example.com/preview/');
  });

  test('the env override reaches buildVersionsJson', () => {
    process.env.DOCS_SITE_URL = 'https://example.com/preview';
    try {
      const overridden = buildVersionsJson(allPackuments(), new Date('2026-08-18T20:00:00.000Z'));
      const lib = overridden.packages.find((e) => e.package === 'aws-cdk-lib')!;
      expect(lib.docsUrl).toBe('https://example.com/preview/v2/docs/aws-cdk-lib-readme.html');
      // Already-absolute entries still pass through untouched.
      const cli = overridden.packages.find((e) => e.package === 'aws-cdk')!;
      expect(cli.docsUrl).toBe('https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd.html');
    } finally {
      delete process.env.DOCS_SITE_URL;
    }
  });

  test('the static v1 entry is hardcoded from CDK_V1, never resolved from npm', () => {
    const v1 = json.packages.find((e) => e.package === CDK_V1.package)!;
    expect(v1.version).toBe(CDK_V1.version);
    expect(v1.date).toBe(CDK_V1.date);
    expect(v1.docsUrl).toBe(CDK_V1.docsUrl);
    expect(v1.releaseUrl).toBe(CDK_V1.releaseUrl);
  });

  test('dates are ISO-8601 datetime strings (full timestamp, not date-only)', () => {
    expect(json.generatedAt).toBe('2026-08-18T20:00:00.000Z');
    for (const entry of json.packages) {
      expect(entry.date).toMatch(ISO_DATETIME);
    }
  });

  test('Cloud Assembly Schema carries the full major.minor.patch, not the major-only display version', () => {
    const schema = json.packages.find((e) => e.package === '@aws-cdk/cloud-assembly-schema')!;
    expect(schema.version).toBe('45.6.2');
    expect(schema.date).toBe('2026-08-07T10:00:00.000Z');
  });

  test('non-major-only packages carry their latest full version', () => {
    const lib = json.packages.find((e) => e.package === 'aws-cdk-lib')!;
    expect(lib.version).toBe('2.264.0');
    expect(lib.date).toBe('2026-08-07T10:00:00.000Z');
  });

  test('a missing publish timestamp yields an empty date, not a crash', () => {
    const packuments = allPackuments();
    packuments.set('aws-cdk-lib', fixturePackument('9.9.9', {}));
    const sparse = buildVersionsJson(packuments);
    expect(sparse.packages.find((e) => e.package === 'aws-cdk-lib')!.date).toBe('');
  });

  test('a missing packument fails the build loudly', () => {
    expect(() => buildVersionsJson(new Map())).toThrow(/missing packument for aws-cdk-lib/);
  });

  test('writeVersionsJson emits valid JSON at versions.json — the page path with the extension swapped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'versions-json-'));
    try {
      const file = writeVersionsJson(json, dir);
      expect(file).toBe(join(dir, VERSIONS_JSON_PATH));
      expect(VERSIONS_JSON_PATH).toBe('versions.json');
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      expect(parsed).toEqual(JSON.parse(JSON.stringify(json)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the emitted build artifact is gitignored', () => {
    const gitignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('docs/public/versions.json');
    // The endpoint moved beside the versions page; the api/-nested entry is gone.
    expect(gitignore).not.toContain('docs/public/api/versions.json');
  });

});

describe('static CDK v1 entry', () => {
  function allPackuments(): Map<string, Packument> {
    const packuments = new Map<string, Packument>();
    for (const pkg of TRACKED_PACKAGES) {
      packuments.set(pkg.name, fixturePackument('2.0.0', {
        '2.0.0': '2026-08-01T00:00:00.000Z',
      }));
    }
    return packuments;
  }

  test('is hardcoded at the final v1 release with the archived docs link', () => {
    expect(CDK_V1.version).toBe('1.204.0');
    expect(CDK_V1.docsUrl).toBe('https://docs.aws.amazon.com/cdk/api/v1/');
  });

  test('carries the v1 release notes and the end-of-support date', () => {
    expect(CDK_V1.releaseUrl).toBe('https://github.com/aws/aws-cdk/releases/tag/v1.204.0');
    expect(CDK_V1.endOfSupport).toBe('2023-06-01');
    // Page copy renders it, so it must be a plain ISO date.
    expect(CDK_V1.endOfSupport).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('the page data ends with the v1 row linking its release notes', () => {
    const data = buildVersionsData(allPackuments());
    const v1 = data.packages[data.packages.length - 1];
    expect(v1.name).toBe(CDK_V1.package);
    expect(v1.label).toBe('AWS CDK v1');
    expect(v1.current.version).toBe('1.204.0');
    expect(v1.current.releaseUrl).toBe(CDK_V1.releaseUrl);
    expect(v1.current.releaseDate).toBe('2023-06-19');
    // The archived reference stays reachable as the row's docs link.
    expect(v1.docsUrl).toBe(CDK_V1.docsUrl);
  });

  test('the page data carries the end-of-support date for the page copy', () => {
    expect(buildVersionsData(allPackuments()).v1EndOfSupport).toBe(CDK_V1.endOfSupport);
  });

  test('versions.json carries the same v1 entry from the same source', () => {
    const json = buildVersionsJson(allPackuments());
    const v1 = json.packages.find((e) => e.package === CDK_V1.package)!;
    expect(v1).toEqual({
      package: CDK_V1.package,
      version: '1.204.0',
      date: '2023-06-19T20:55:21.633Z',
      releaseUrl: 'https://github.com/aws/aws-cdk/releases/tag/v1.204.0',
      docsUrl: 'https://docs.aws.amazon.com/cdk/api/v1/',
    });
  });

  test('v1 is never resolved from npm and is not a tracked package', () => {
    // No packument for CDK_V1.package is required or consulted…
    expect(TRACKED_PACKAGES.map((p) => p.name)).not.toContain(CDK_V1.package);
    expect(() => buildVersionsData(allPackuments())).not.toThrow();
    // …and loadVersionsData's fetch list (asserted above) excludes it.
  });

  test('live v2 entries are unchanged by the v1 row', () => {
    const data = buildVersionsData(allPackuments());
    expect(data.packages.slice(0, TRACKED_PACKAGES.length).map((p) => p.name))
      .toEqual(TRACKED_PACKAGES.map((p) => p.name));
  });
});
