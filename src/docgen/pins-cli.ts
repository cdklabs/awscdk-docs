import * as path from 'path';
import { CDK_PIN_KEYS, CDK_PINS_FILE, isCdkPinKey, readCdkPins, withCdkPin, writeCdkPins } from './pins.js';

/**
 * Set one CDK version pin. Invoked by the nightly cdk-version-check
 * workflow as `npx projen cdk:pin <key> <version>`.
 */
const [key, version] = process.argv.slice(2);

try {
  if (!key || !version) {
    throw new Error(`usage: cdk:pin <${CDK_PIN_KEYS.join('|')}> <version>`);
  }
  if (!isCdkPinKey(key)) {
    throw new Error(`unknown pin "${key}"; expected one of ${CDK_PIN_KEYS.join(', ')}`);
  }
  const file = path.join(process.cwd(), CDK_PINS_FILE);
  const before = readCdkPins(file);
  if (before[key] === version) {
    // eslint-disable-next-line no-console
    console.log(`cdk:pin: ${key} already at ${version}`);
  } else {
    writeCdkPins(withCdkPin(before, key, version), file);
    // eslint-disable-next-line no-console
    console.log(`cdk:pin: ${key} ${before[key]} -> ${version}`);
  }
} catch (err: unknown) {
  // eslint-disable-next-line no-console
  console.error(`cdk:pin: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
