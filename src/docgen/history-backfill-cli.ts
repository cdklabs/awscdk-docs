import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import {
  mergeSeedLedger,
  Packument,
  REGISTRY_ORIGIN,
  seedHistoryLedger,
  selectReleaseWindow,
} from './history-backfill.js';
import { loadLedger, writeLedger } from './history.js';

interface Arguments {
  readonly output: string;
  readonly releases: number;
  readonly target: string;
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error('usage: scripts/backfill-version-history.sh --output FILE [--releases N] [--target X.Y.Z]');
    }
    values.set(name, value);
  }
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    readonly devDependencies?: Record<string, string>;
  };
  const target = values.get('--target') ?? packageJson.devDependencies?.['aws-cdk-lib'];
  const output = values.get('--output');
  if (!target || !output) {
    throw new Error('--output is required and aws-cdk-lib must be pinned in package.json or supplied with --target');
  }
  const releases = values.has('--releases') ? Number(values.get('--releases')) : Number.MAX_SAFE_INTEGER;
  return { output: resolve(output), releases, target };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const response = await fetch(`${REGISTRY_ORIGIN}/aws-cdk-lib`);
  if (!response.ok) {
    throw new Error(`failed to fetch aws-cdk-lib packument: ${response.status} ${response.statusText}`);
  }
  const releases = selectReleaseWindow(await response.json() as Packument, args.target, args.releases);
  for (const release of releases) {
    process.stderr.write(`backfill: ${release.version}\n`);
  }
  const existing = loadLedger(args.output);
  const result = await seedHistoryLedger(releases);
  const ledger = mergeSeedLedger(result.ledger, existing);
  writeLedger(args.output, ledger);
  process.stdout.write(`${JSON.stringify({
    firstVersion: releases[0].version,
    lastVersion: releases[releases.length - 1]?.version,
    releases: releases.length,
    coverage: result.coverage,
    bytes: statSync(args.output).size,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
