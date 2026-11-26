import * as compilerSfc from "vue/compiler-sfc";

// The Vue plugin caches every page's template AST for the whole build; a compiled AST only needs `source` to re-parse.
export const astReleasingCompiler: typeof compilerSfc = {
  ...compilerSfc,
  compileTemplate(options) {
    const result = compilerSfc.compileTemplate(options);
    const ast = options.ast as unknown as Record<string, unknown> | undefined;
    if (ast?.transformed) {
      for (const key of Object.keys(ast)) {
        if (key !== "transformed" && key !== "source") delete ast[key];
      }
    }
    return result;
  },
};
