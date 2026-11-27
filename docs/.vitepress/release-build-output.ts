import type { Plugin, Rollup } from "vite";

/**
 * The output fields VitePress reads after a build has written its files: it finds the app, page and CSS chunks,
 * lists their imports for the preload links and checks for the default theme. Everything else is dropped.
 */
export const KEPT_OUTPUT_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "fileName",
  "name",
  "isEntry",
  "facadeModuleId",
  "moduleIds",
  "imports",
  "dynamicImports",
]);

/** Drop every field of a written chunk or asset that VitePress does not read again, in place. */
export function releaseOutput(bundle: Rollup.OutputBundle): void {
  for (const file of Object.values(bundle)) {
    const record = file as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!KEPT_OUTPUT_FIELDS.has(key)) delete record[key];
    }
  }
}

/**
 * Vite plugin applying {@link releaseOutput} once the files are on disk. VitePress keeps the client and SSR build
 * results until every page is rendered, and their code and module sources would otherwise stay in memory that long.
 */
export function releaseBuildOutput(): Plugin {
  return {
    name: "cdk-docs:release-build-output",
    apply: "build",
    // Sequential and last, so no other plugin's writeBundle still reads the fields being dropped.
    writeBundle: { order: "post", sequential: true, handler: (_options, bundle) => releaseOutput(bundle) },
  };
}
