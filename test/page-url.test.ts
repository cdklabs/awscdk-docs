import { pageUrl } from '../docs/.vitepress/page-url.js';

const SITE = 'https://docs.aws.amazon.com/cdk/api/';

describe('pageUrl', () => {
  test('the home page is the site root, every other route ends in .html', () => {
    expect(pageUrl('index.md', SITE)).toBe(SITE);
    expect(pageUrl('v2/aws-cdk-lib/aws_s3/Bucket.md', SITE)).toBe(`${SITE}v2/aws-cdk-lib/aws_s3/Bucket.html`);
  });

  test('a site URL without a trailing slash joins without doubling it', () => {
    expect(pageUrl('versions.md', 'https://docs.aws.amazon.com/cdk/api')).toBe('https://docs.aws.amazon.com/cdk/api/versions.html');
  });
});
