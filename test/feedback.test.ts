import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  editLinkFor,
  isGeneratedPage,
  REPO_URL,
  reportIssueUrl,
} from '../docs/.vitepress/theme/feedback.js';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// Upstream README URLs docgen resolves from the jsii assembly.
const S3_README = 'https://github.com/aws/aws-cdk/blob/HEAD/packages/aws-cdk-lib/aws-s3/README.md';
const ALPHA_README =
  'https://github.com/aws/aws-cdk/blob/HEAD/packages/@aws-cdk/aws-bedrock-alpha/README.md';

describe('generated page detection', () => {
  test('pages under v2/ are generated', () => {
    expect(isGeneratedPage('v2/docs/aws-cdk-lib.App.md')).toBe(true);
    expect(isGeneratedPage('v2/docs/constructs-readme.md')).toBe(true);
  });

  test('hand-written pages are not', () => {
    expect(isGeneratedPage('index.md')).toBe(false);
    expect(isGeneratedPage('versions.md')).toBe(false);
  });

  test('the generated /v2/ overview is', () => {
    expect(isGeneratedPage('v2/index.md')).toBe(true);
  });
});

describe('edit link generation', () => {
  test('a submodule README page links its real upstream README', () => {
    expect(editLinkFor('v2/docs/aws-cdk-lib.aws_s3-readme.md', S3_README)).toBe(S3_README);
  });

  test('an alpha package resolves to its own repository directory', () => {
    expect(editLinkFor('v2/docs/aws-cdk-lib.aws_bedrock-readme.md', ALPHA_README)).toBe(
      ALPHA_README,
    );
  });

  test('a symbol page has no upstream markdown file, so it gets no link', () => {
    expect(editLinkFor('v2/docs/aws-cdk-lib.App.md')).toBeUndefined();
    expect(editLinkFor('v2/docs/constructs-readme.md')).toBeUndefined();
  });

  test('the generated /v2/ overview gets no link without an upstream file', () => {
    expect(editLinkFor('v2/index.md')).toBeUndefined();
  });

  test('no page ever links the docgen source directory again', () => {
    const helper = readFileSync(resolve(THEME_DIR, 'feedback.ts'), 'utf-8');
    expect(helper).not.toContain('tree/main/src/docgen');
  });

  test('hand-written pages link to the markdown file editor', () => {
    expect(editLinkFor('versions.md')).toBe(
      `${REPO_URL}/edit/main/docs/versions.md`,
    );
    expect(editLinkFor('index.md')).toBe(`${REPO_URL}/edit/main/docs/index.md`);
  });

  test('a page that names its upstream file wins over any path rule', () => {
    // The upstream URL is checked first, deliberately: a page that records
    // where its prose came from knows better than a path heuristic. docgen
    // only emits the key for generated pages, so this is reachable today
    // only if a hand-written page sets it itself — in which case honoring
    // it is the author's stated intent.
    expect(editLinkFor('index.md', S3_README)).toBe(S3_README);
  });
});

describe('report issue URL construction', () => {
  const params = {
    pageTitle: 'Bucket',
    pageUrl: 'https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket',
    cdkVersion: '2.263.0',
    userAgent: 'Mozilla/5.0 (test)',
  };

  test('targets the new-issue endpoint of the docs repo', () => {
    const url = new URL(reportIssueUrl(params));
    expect(url.origin + url.pathname).toBe('https://github.com/cdklabs/awscdk-docs/issues/new');
  });

  test('pre-fills title, labels, and a body with page context', () => {
    const query = new URL(reportIssueUrl(params)).searchParams;
    expect(query.get('title')).toBe('Docs: Bucket');
    expect(query.get('labels')).toBe('documentation');
    const body = query.get('body')!;
    expect(body).toContain(`- Page: ${params.pageUrl}`);
    expect(body).toContain('- AWS CDK version: 2.263.0');
    expect(body).toContain('- Browser: Mozilla/5.0 (test)');
  });

  test('missing version and user agent fall back to "unknown"', () => {
    const body = new URL(
      reportIssueUrl({ pageTitle: 'App', pageUrl: 'https://example.com/app' }),
    ).searchParams.get('body')!;
    expect(body).toContain('- AWS CDK version: unknown');
    expect(body).toContain('- Browser: unknown');
  });

  test('special characters in the title survive a URL round-trip', () => {
    const title = new URL(
      reportIssueUrl({ ...params, pageTitle: 'Map<string, & weird>' }),
    ).searchParams.get('title');
    expect(title).toBe('Docs: Map<string, & weird>');
  });
});

describe('footer links component wiring', () => {
  const component = readFileSync(resolve(THEME_DIR, 'PageFooterLinks.vue'), 'utf-8');

  test('renders the edit link from the shared helper', () => {
    expect(component).toContain('editLinkFor');
    expect(component).toContain('Edit this page');
  });

  test('the edit link is conditional and the generator-source label is gone', () => {
    expect(component).toContain('v-if="editUrl"');
    expect(component).not.toContain('Edit the generator source');
    expect(component).not.toContain('isGeneratedPage');
    expect(component).toContain('upstreamEditUrl');
  });

  test('builds the report-issue link from shared helpers', () => {
    expect(component).toContain('reportIssueUrl');
    expect(component).toContain('navigator.userAgent');
    expect(component).toContain('Report an issue with this page');
  });

  test('the helpful?-vote widget is gone', () => {
    expect(existsSync(resolve(THEME_DIR, 'PageFeedback.vue'))).toBe(false);
    expect(component).not.toContain('Was this page helpful?');
    expect(component).not.toContain('localStorage.getItem');
    expect(component).not.toContain('localStorage.setItem');
    const feedback = readFileSync(resolve(THEME_DIR, 'feedback.ts'), 'utf-8');
    expect(feedback).not.toContain('feedbackStorageKey');
  });

  test('component styles only use theme variables (works in both themes)', () => {
    const style = component.slice(component.indexOf('<style'));
    const colors = style.match(/(?:color|background-color|border(?:-color)?):[^;]+;/g) ?? [];
    expect(colors.length).toBeGreaterThan(0);
    for (const declaration of colors) {
      expect(declaration).toMatch(/var\(--vp-/);
    }
  });

  test('theme layout renders the component in the doc-after slot', () => {
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    expect(entry).toContain('PageFooterLinks');
    expect(entry).toContain('"doc-after"');
  });
});

describe('VitePress config integration', () => {
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');

  test('native editLink is disabled so the edit link is not duplicated', () => {
    expect(config).not.toContain('editLink: {');
  });

  test('installed CDK version is exposed to the footer component', () => {
    expect(config).toContain('cdkVersion');
  });
});
