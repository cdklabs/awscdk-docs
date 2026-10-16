import { canonicalHead } from '../docs/.vitepress/canonical.js';

const SITE = 'https://docs.aws.amazon.com/cdk/api/';

describe('canonicalHead', () => {
  test('an API page canonicalizes to its own absolute URL', () => {
    expect(canonicalHead('v2/aws-cdk-lib/aws_s3/Bucket.md', SITE)).toEqual([
      'link',
      { rel: 'canonical', href: `${SITE}v2/aws-cdk-lib/aws_s3/Bucket.html` },
    ]);
  });

  test('the home page canonicalizes to the site root', () => {
    expect(canonicalHead('index.md', SITE)).toEqual(['link', { rel: 'canonical', href: SITE }]);
  });

  test('the href carries no language query', () => {
    const [, attrs] = canonicalHead('v2/aws-cdk-lib/aws_sqs/Queue.md', SITE);
    expect(attrs.href).not.toContain('?');
  });
});
