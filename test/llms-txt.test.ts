import { renderLlmsTxt, titleOf } from '../src/docgen/llms-txt.js';

const SITE = 'https://docs.example.com/cdk/api/';

const entry = (module: string, title = module) => ({
  module,
  twin: `v2/docs/${module.replace('/', '_')}-readme.md`,
  title,
});

describe('renderLlmsTxt', () => {
  test('renders the proposal shape: H1, summary blockquote naming the version and the sitemap, then one module list', () => {
    const text = renderLlmsTxt({
      siteTitle: 'AWS CDK Reference',
      version: '2.269.0',
      siteUrl: SITE,
      entries: [entry('aws-cdk-lib')],
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('# AWS CDK Reference');
    expect(lines[1]).toBe('');
    expect(lines[2]).toMatch(/^> API reference for version 2\.269\.0\. /);
    expect(lines[2]).toMatch(/\[sitemap\.xml\]\(https:\/\/docs\.example\.com\/cdk\/api\/sitemap\.xml\)\.$/);
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('## Modules');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.match(/^## .*$/gm)).toEqual(['## Modules']);
  });

  test('every entry is one absolute link line, titled by the overview and annotated with the module id', () => {
    const text = renderLlmsTxt({
      siteTitle: 't',
      version: '1',
      siteUrl: SITE,
      entries: [entry('aws-cdk-lib.aws_s3', 'Amazon S3 Construct Library')],
    });
    expect(text).toContain(
      '- [Amazon S3 Construct Library](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3-readme.md): aws-cdk-lib.aws_s3',
    );
  });

  test('sorts by module id in code-point order, so the package root heads its own submodules and runners agree', () => {
    const text = renderLlmsTxt({
      siteTitle: 't',
      version: '1',
      siteUrl: SITE,
      entries: [entry('aws-cdk-lib.aws_sqs'), entry('constructs'), entry('aws-cdk-lib'), entry('@aws-cdk/aws-amplify-alpha'), entry('aws-cdk-lib.aws_s3')],
    });
    const ids = [...text.matchAll(/^- \[.*\): (\S+)$/gm)].map((m) => m[1]);
    expect(ids).toEqual(['@aws-cdk/aws-amplify-alpha', 'aws-cdk-lib', 'aws-cdk-lib.aws_s3', 'aws-cdk-lib.aws_sqs', 'constructs']);
  });

  test('lists a module once however many times it was recorded, keeping the last record', () => {
    const text = renderLlmsTxt({
      siteTitle: 't',
      version: '1',
      siteUrl: SITE,
      entries: [entry('constructs', 'first'), entry('constructs', 'second')],
    });
    expect(text.match(/^- /gm)).toHaveLength(1);
    expect(text).toContain('- [second](');
  });

  test('a site URL without a trailing slash still yields correct absolute links', () => {
    const expected = '](https://docs.example.com/cdk/api/v2/docs/x-readme.md)';
    for (const siteUrl of ['https://docs.example.com/cdk/api', 'https://docs.example.com/cdk/api/']) {
      const text = renderLlmsTxt({ siteTitle: 't', version: '1', siteUrl, entries: [entry('x')] });
      expect(text).toContain(expected);
      expect(text).not.toContain('//v2/');
    }
  });
});

describe('titleOf', () => {
  test('takes the first H1', () => {
    expect(titleOf('---\nx: 1\n---\n\n# Amazon S3 Construct Library\n\ntext\n## Not this', 'fb')).toBe('Amazon S3 Construct Library');
  });

  test('strips inline HTML such as badges and collapses whitespace', () => {
    expect(titleOf('# Foo <span class="badge">Added in 2.1</span>  Bar', 'fb')).toBe('Foo Bar');
  });

  test('falls back to the module id when there is no H1', () => {
    expect(titleOf('no heading here\n## only h2', 'aws-cdk-lib.aws_x')).toBe('aws-cdk-lib.aws_x');
  });
});
