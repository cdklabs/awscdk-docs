import * as fs from 'fs';
import * as path from 'path';
import {
  distDirFromEnv,
  listDistTarballs,
  planDistInstall,
  readJsiiTarballNames,
} from './dist.js';
import { generateDocs, loadConfig, updateHistoryLedger } from './index.js';
import { generateThirdPartyLicenses } from './third-party-licenses.js';
import { readVersionSnapshot, VERSION_SNAPSHOT_FILE } from './versions.js';

const root = process.cwd();
const ledgerFile = path.join(root, 'docgen.baseline.json');

try {
  let config = loadConfig(path.join(root, 'docgen.config.json'));
  const distDir = distDirFromEnv();
  if (distDir !== undefined) {
    const plan = planDistInstall(config.modules, readJsiiTarballNames(listDistTarballs(distDir)));
    config = { ...config, modules: plan.modules };
  }

  if (process.argv.includes('--third-party-licenses')) {
    const file = generateThirdPartyLicenses(root);
    // eslint-disable-next-line no-console
    console.log(`docgen: wrote ${file}`);
  } else if (process.argv.includes('--update-ledger')) {
    // The explicit ledger update the nightly version refresh runs after installing the new release. Changes are
    // dated by the release's npm publish time when the committed snapshot tracks the package.
    const snapshotFile = path.join(root, VERSION_SNAPSHOT_FILE);
    const snapshot = fs.existsSync(snapshotFile) ? readVersionSnapshot(snapshotFile) : undefined;
    const releasedAt = (name: string, version: string): string | undefined => snapshot?.packages[name]?.time[version];
    const { introduced, changed, seeded } = updateHistoryLedger(config, ledgerFile, root, releasedAt);
    // eslint-disable-next-line no-console
    console.log(`docgen: ledger ${ledgerFile} — ${introduced} introduced, ${changed} changed, ${seeded} seeded`);
  } else {
    const files = generateDocs(config, {
      outDir: path.join(root, 'docs', 'v2'),
      publicDir: path.join(root, 'docs', 'public'),
      overviewFile: path.join(root, 'docs', 'v2', 'index.md'),
      overviewSourceFile: path.join(root, 'docs', 'aws-construct-library.md'),
      // Agent-oriented twins, outside docs/ so VitePress never sees them; the shard merge overlays them once.
      agentOutDir: path.join(root, 'dist-agent-markdown'),
      ledgerFile,
    });

    // eslint-disable-next-line no-console
    console.log(`docgen: generated ${files.length} files for ${config.modules.join(', ')}`);
  }
} catch (err: unknown) {
  // eslint-disable-next-line no-console
  console.error(`docgen: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
