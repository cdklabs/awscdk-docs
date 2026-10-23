/** `docs:dist:install` — install the documented modules from $CDK_DIST_DIR so `docs:generate` reads them. */

import { spawnSync } from 'child_process';
import * as path from 'path';
import {
  CDK_DIST_DIR_ENV,
  distDirFromEnv,
  listDistTarballs,
  planDistInstall,
  readBuildJson,
  readJsiiTarballNames,
  verifyInstalledModules,
} from './dist.js';
import { loadConfig } from './index.js';

const root = process.cwd();

try {
  const distDir = distDirFromEnv();
  if (distDir === undefined) {
    throw new Error(`${CDK_DIST_DIR_ENV} is not set — nothing to install`);
  }

  const build = readBuildJson(distDir);
  const config = loadConfig(path.join(root, 'docgen.config.json'));
  const plan = planDistInstall(config.modules, readJsiiTarballNames(listDistTarballs(distDir)));

  // --no-save keeps committed pins unchanged. The candidate replaces that pinned tree, so ignore its stale peer graph;
  // verification below still requires every installed module to match the candidate release.
  const install = spawnSync(
    'npm',
    ['install', '--no-save', '--legacy-peer-deps', ...plan.installs.map((i) => i.tarball)],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (install.status !== 0) {
    throw new Error(`npm install of ${plan.installs.length} dist tarball(s) failed with exit ${install.status}`);
  }

  verifyInstalledModules(root, plan.installs.map((i) => i.module), build.version);

  // eslint-disable-next-line no-console
  console.log(
    `docs:dist:install: installed ${plan.installs.length} module(s) at ${build.version}` +
      `${plan.excluded.length > 0 ? `, left ${plan.excluded.join(', ')} to npm` : ''}` +
      `${plan.dropped.length > 0 ? `, dropped ${plan.dropped.join(', ')} without dist tarballs` : ''}`,
  );
} catch (err: unknown) {
  // eslint-disable-next-line no-console
  console.error(`docs:dist:install: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
