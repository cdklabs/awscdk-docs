import { assetHash, hashedAssetName } from '../src/docgen/asset-hash.js';

describe('content-hashed asset names', () => {
  test('the same content reproduces the same filename', () => {
    expect(hashedAssetName('sidebar', '[{"text":"S3"}]')).toBe(hashedAssetName('sidebar', '[{"text":"S3"}]'));
  });

  test('changed content produces a different filename', () => {
    expect(hashedAssetName('sidebar', '[{"text":"S3"}]')).not.toBe(hashedAssetName('sidebar', '[{"text":"SQS"}]'));
  });

  test('the name carries the base and an eight-character hash before .js', () => {
    // scripts/e2e-serve.cjs gives its long cache lifetime to this shape alone.
    expect(hashedAssetName('symbols', '[]')).toMatch(/^symbols\.[0-9a-f]{8}\.js$/);
    expect(assetHash('[]')).toHaveLength(8);
  });

  test('the hash depends on the content alone, not on the base name', () => {
    expect(assetHash('[]')).toBe(assetHash('[]'));
    expect(hashedAssetName('sidebar', '[]').split('.')[1]).toBe(hashedAssetName('symbols', '[]').split('.')[1]);
  });
});
