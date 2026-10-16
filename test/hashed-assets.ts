import { readdirSync } from 'fs';
import { join } from 'path';

/** Path of a content-hashed served asset in a generated directory, read back the way the site build reads it. */
export function hashedAssetPath(dir: string, base: string): string {
  const pattern = new RegExp(`^${base}\\.[0-9a-f]{8}\\.js$`);
  const file = readdirSync(dir).find((name) => pattern.test(name));
  if (!file) {
    throw new Error(`no ${base} asset in ${dir}`);
  }
  return join(dir, file);
}
