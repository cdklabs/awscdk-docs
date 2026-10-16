// VitePress build-time data loader for the /versions page. Reads the committed version snapshot — no registry
// call at build time, and identical output for two builds of one commit unless CDK_DIST_DIR selects dist mode.
//
// Deliberately a one-line shim: `loadVersionsData()` owns the whole path, including emitting the machine-readable
// endpoint into the public dir, from where VitePress copies it into the built site at `/versions.json`.
import { resolve } from 'path';
import { loadVersionsData, VERSION_SNAPSHOT_FILE, VersionsData } from '../src/docgen/versions';

declare const data: VersionsData;
export { data };

export default {
  load(): VersionsData {
    return loadVersionsData(
      resolve(import.meta.dirname, '..', VERSION_SNAPSHOT_FILE),
      resolve(import.meta.dirname, 'public'),
    );
  },
};
