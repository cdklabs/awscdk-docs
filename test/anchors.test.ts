import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createMarkdownRenderer, type MarkdownRenderer } from 'vitepress';
import { generateDocs } from '../src/docgen/index.js';

const ROOT = resolve(import.meta.dirname, '..');

// Anchors are the public deep-link contract of the API pages. Asserted on the HTML VitePress renders from the
// generated markdown, so a heading reworded in a renderer cannot silently move an anchor.
describe('API page anchors', () => {
  let outDir: string;
  let md: MarkdownRenderer;

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'anchors-'));
    generateDocs({ modules: ['aws-cdk-lib', 'constructs'] }, { outDir, packageRoot: ROOT, languages: ['ts'] });
    md = await createMarkdownRenderer(outDir);
  }, 120_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  function ids(page: string): string[] {
    const source = readFileSync(join(outDir, 'docs', `${page}.md`), 'utf-8').replace(/^---\n[\s\S]*?\n---\n/, '');
    return [...md.render(source).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  }

  function titleId(page: string): string | undefined {
    const source = readFileSync(join(outDir, 'docs', `${page}.md`), 'utf-8');
    const h1 = source.split('\n').find((line) => line.startsWith('# '))!;
    return /<h1[^>]*\bid="([^"]+)"/.exec(md.render(h1))?.[1];
  }

  test.each([
    ['aws-cdk-lib.aws_sqs.Queue', 'class-queue-construct'],
    ['aws-cdk-lib.aws_s3.CfnBucket', 'class-cfnbucket-construct'],
    ['aws-cdk-lib.Duration', 'class-duration'],
    ['aws-cdk-lib.App', 'class-app'],
    ['aws-cdk-lib.Resource', 'class-resource'],
    ['constructs.Construct', 'class-construct'],
    ['aws-cdk-lib.aws_s3.mixins.BucketVersioning', 'class-bucketversioning-mixin'],
    ['aws-cdk-lib.aws_sqs.IQueue', 'interface-iqueue'],
    ['aws-cdk-lib.aws_sqs.QueueProps', 'interface-queueprops'],
    ['aws-cdk-lib.aws_s3.CfnBucket.LifecycleConfigurationProperty', 'interface-lifecycleconfigurationproperty'],
    ['aws-cdk-lib.aws_sqs.QueueEncryption', 'enum-queueencryption'],
  ])('%s titles itself #%s', (page, id) => {
    expect(titleId(page)).toBe(id);
  });

  test('section anchors are fixed ids, not slugs of the heading text', () => {
    expect(ids('aws-cdk-lib.aws_sqs.Queue')).toEqual(expect.arrayContaining([
      'example', 'initializer', 'props-queueprops', 'properties', 'methods',
    ]));
    expect(ids('aws-cdk-lib.aws_sqs.QueueProps')).toContain('used-as-props-by');
    expect(ids('aws-cdk-lib.aws_sqs.QueueEncryption')).toEqual(expect.arrayContaining(['members', 'referenced-by']));
  });

  test('every enum member has an anchor of its lowercased name', () => {
    expect(ids('aws-cdk-lib.aws_sqs.QueueEncryption')).toEqual(expect.arrayContaining([
      'unencrypted', 'kms_managed', 'kms', 'sqs_managed',
    ]));
  });

  test('module overview sections cannot collide with README headings', () => {
    const overview = ids('aws-cdk-lib.aws_glue-readme');
    expect(overview).toContain('module-types');
    expect(new Set(overview).size).toBe(overview.length);
  });
});
