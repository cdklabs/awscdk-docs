// Appends a per-build query to the VitePress router's `hashmap.json` fallback fetch. The file has a fixed,
// unhashed name, so without the query a browser or CDN can answer that fetch with a map from an earlier deploy,
// whose page-chunk hashes no longer exist, and every later client-side navigation 404s until a reload.
import { execFileSync } from "node:child_process";

/** The router's fallback fetch target, exactly as VitePress emits it in `client/app/router.js`. */
export const HASHMAP_FETCH = "siteDataRef.value.base + 'hashmap.json'";

const ROUTER_MODULE = /[\\/]vitepress[\\/]dist[\\/]client[\\/]app[\\/]router\.js$/;
const BUILD_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The value identifying this build's `hashmap.json`: `DOCS_BUILD_ID` when set, otherwise the checked-out commit.
 * A commit determines every build input, so two builds of one commit share a map and may share a cached copy.
 */
export function resolveBuildId(env: NodeJS.ProcessEnv = process.env, gitHead: () => string = readGitHead): string {
  const id = env.DOCS_BUILD_ID?.trim() || gitHead();
  if (id && !BUILD_ID.test(id)) {
    throw new Error(`DOCS_BUILD_ID must match ${BUILD_ID}, got ${JSON.stringify(id)}`);
  }
  if (!id && env.SHARD_BUILD) {
    // Every shard must bake the same value into the shared router chunk; an unset one would also ship no buster.
    throw new Error("a shard build needs DOCS_BUILD_ID: set it once for the whole sharded build");
  }
  return id;
}

function readGitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** Rewrite the router source so its `hashmap.json` fetch carries `?v=<buildId>`. */
export function bustHashmapFetch(source: string, buildId: string): string {
  const occurrences = source.split(HASHMAP_FETCH).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expected one hashmap.json fetch in the VitePress router, found ${occurrences}`);
  }
  const target = JSON.stringify(`hashmap.json?v=${encodeURIComponent(buildId)}`);
  return source.replace(HASHMAP_FETCH, `siteDataRef.value.base + ${target}`);
}

/** Vite plugin applying {@link bustHashmapFetch} to the VitePress router. A build without a build id is untouched. */
export function hashmapCacheBuster(buildId: string) {
  let rewritten = false;
  return {
    name: "cdk-docs:hashmap-cache-buster",
    enforce: "pre" as const,
    apply: "build" as const,
    buildStart(): void {
      rewritten = false;
    },
    transform(code: string, id: string): string | undefined {
      if (!buildId || !ROUTER_MODULE.test(id)) {
        return undefined;
      }
      rewritten = true;
      return bustHashmapFetch(code, buildId);
    },
    buildEnd(error?: Error): void {
      // A VitePress upgrade that moves the router must fail the build rather than silently drop the buster.
      if (buildId && !error && !rewritten) {
        throw new Error("the VitePress router module was not part of the build, so hashmap.json is not cache-busted");
      }
    },
  };
}
