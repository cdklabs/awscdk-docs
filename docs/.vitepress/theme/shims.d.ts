// Vite compiles single-file components; `tsc` cannot read them. Declared so the
// theme entry's component imports resolve under `docs:typecheck` — the bodies
// themselves are not type-checked, which needs vue-tsc.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
