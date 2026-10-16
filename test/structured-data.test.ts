import { PUBLISHER, SITE_NAME, structuredData, structuredDataHead } from '../docs/.vitepress/structured-data.js';
import { CONTENT_REVISED_DATE } from '../src/page-history.js';

const SITE = 'https://docs.aws.amazon.com/cdk/api/';

const apiPage = {
  relativePath: 'v2/aws-cdk-lib/aws_s3/Bucket.md',
  title: 'Bucket',
  description: 'An S3 bucket with associated policy objects.',
  frontmatter: {
    cdkDocsIntroducedIn: '2.100.0',
    cdkDocsLastChangedIn: '2.300.0',
    cdkDocsLastChangedAt: '2099-01-02T03:04:05.000Z',
  },
};

describe('the home page node', () => {
  const data = structuredData({ relativePath: 'index.md', title: SITE_NAME, frontmatter: {} }, SITE);

  test('is a WebSite carrying the publisher and an @id the article pages can reference', () => {
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE}#website`,
      'name': SITE_NAME,
      'url': SITE,
      'publisher': PUBLISHER,
      'dateModified': `${CONTENT_REVISED_DATE}T00:00:00.000Z`,
    });
  });
});

describe('an API page node', () => {
  const data = structuredData(apiPage, SITE);

  test('is a TechArticle with the page headline, description and absolute URL', () => {
    expect(data['@type']).toBe('TechArticle');
    expect(data.headline).toBe('Bucket');
    expect(data.description).toBe('An S3 bucket with associated policy objects.');
    expect(data.url).toBe(`${SITE}v2/aws-cdk-lib/aws_s3/Bucket.html`);
  });

  test('references the site node by @id rather than repeating it', () => {
    expect(data.isPartOf).toEqual({ '@id': `${SITE}#website` });
  });

  test('dateModified is the release that changed the page, not the day of the build', () => {
    expect(data.dateModified).toBe('2099-01-02T03:04:05.000Z');
    expect(data.dateModified).not.toContain(new Date().toISOString().slice(0, 10));
  });

  test('a page with no recorded change falls back to the site-wide revision date', () => {
    const plain = structuredData({ relativePath: 'versions.md', title: 'Versions', frontmatter: {} }, SITE);
    expect(plain.dateModified).toBe(`${CONTENT_REVISED_DATE}T00:00:00.000Z`);
  });

  test('an absent description is omitted rather than emitted empty', () => {
    const noDescription = structuredData({ relativePath: 'versions.md', title: 'Versions', frontmatter: {} }, SITE);
    expect(noDescription).not.toHaveProperty('description');
  });
});

describe('structuredDataHead', () => {
  const head = structuredDataHead(apiPage, SITE);

  test('is a script tag whose body parses as the node', () => {
    expect(head[0]).toBe('script');
    expect(head[1]).toEqual({ type: 'application/ld+json' });
    expect(JSON.parse(head[2])).toEqual(structuredData(apiPage, SITE));
  });

  test('stays under the per-page budget the issue set', () => {
    expect(head[2].length).toBeLessThan(1024);
  });

  test('a title cannot terminate the script element or start a comment', () => {
    const hostile = {
      ...apiPage,
      title: '</script><script>alert(1)</script>',
      description: 'a <!-- b --> & c\u2028d',
    };
    const body = structuredDataHead(hostile, SITE)[2];
    expect(body).not.toMatch(/[<>&\u2028\u2029]/);
    expect(body).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(body)).toEqual(structuredData(hostile, SITE));
  });
});
