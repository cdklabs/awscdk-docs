import * as crypto from 'crypto';

// Eight hex characters, the shape VitePress names its own build assets with.
const HASH_LENGTH = 8;

/** Content hash for a served asset's filename. */
export function assetHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, HASH_LENGTH);
}

/** Filename a served asset is written under: its own content decides the name, so changed content changes the URL. */
export function hashedAssetName(base: string, content: string, ext = 'js'): string {
  return `${base}.${assetHash(content)}.${ext}`;
}
