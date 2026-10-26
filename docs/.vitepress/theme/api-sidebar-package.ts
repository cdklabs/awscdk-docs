import type {
  ApiSidebarKind,
  ApiSidebarNode,
  ApiSidebarPackageModule,
  ApiSidebarPackageModuleData,
} from './api-sidebar.js';

export type PackageSidebarModule = ApiSidebarPackageModule;

/** Expand the compact generated row; all repeated fields derive from its FQN. */
export function decodePackageModules(
  data: ApiSidebarPackageModuleData,
  skeleton: readonly ApiSidebarNode[],
  apiRoot: string,
): PackageSidebarModule[] {
  const root = apiRoot.endsWith('/') ? apiRoot : `${apiRoot}/`;
  const [packedFlags, scopedAssemblies, extras = []] = data;
  const stems = [...new Set(skeleton.flatMap((node) => node.items ?? []).flatMap((section) => section.modules ?? []))];
  const assemblies = [...scopedAssemblies]
    .map((assembly) => ({ assembly, stem: assembly.replace(/\//g, '_') }))
    .sort((a, b) => b.stem.length - a.stem.length);
  const expand = (fqn: string, sectionStem: string, flags: number): PackageSidebarModule => {
    const assembly = fqn.split('.')[0];
    const service = fqn.includes('/aws-')
      || fqn.split('.').some((part) => part.startsWith('aws_') || part.startsWith('alexa'));
    return {
      fqn,
      assembly,
      service,
      cloudFormationOnly: flags % 2 === 1,
      ...(flags >= 2 ? { overview: `${root}docs/${sectionStem}-readme` } : {}),
      sectionStems: sectionStem ? [sectionStem] : [],
    };
  };
  return [
    ...stems.flatMap((sectionStem, index) => {
      const flags = Number(packedFlags[index] ?? '4');
      if (flags === 4) return [];
      const scoped = assemblies.find(({ stem }) => sectionStem === stem || sectionStem.startsWith(`${stem}.`));
      const fqn = scoped
        ? scoped.assembly + sectionStem.slice(scoped.stem.length)
        : sectionStem;
      return [expand(fqn, sectionStem, flags)];
    }),
    ...extras.map(([fqn, flags]) => expand(fqn, fqn.replace(/\//g, '_'), flags)),
  ];
}

const KIND_LABELS: ReadonlyArray<readonly [ApiSidebarKind, string]> = [
  ['construct', 'Constructs'],
  ['mixin', 'Mixins'],
  ['class', 'Classes'],
  ['struct', 'Structs'],
  ['interface', 'Interfaces'],
  ['enum', 'Enums'],
  ['cfn-resource', 'CloudFormation Resources'],
  ['cfn-property', 'CloudFormation Property Types'],
];

function packageKey(module: PackageSidebarModule): string {
  if (module.assembly !== 'aws-cdk-lib') return module.assembly;
  if (module.fqn === module.assembly) return module.assembly;
  return `${module.assembly}.${module.fqn.slice(module.assembly.length + 1).split('.')[0]}`;
}

function compareFqn(a: string, b: string): number {
  const aLib = a === 'aws-cdk-lib' || a.startsWith('aws-cdk-lib.');
  const bLib = b === 'aws-cdk-lib' || b.startsWith('aws-cdk-lib.');
  if (aLib !== bLib) return aLib ? -1 : 1;
  const aa = a.split('.');
  const bb = b.split('.');
  for (let index = 0; index < Math.max(aa.length, bb.length); index++) {
    if (aa[index] === undefined) return -1;
    if (bb[index] === undefined) return 1;
    const compared = aa[index].localeCompare(bb[index], 'en', { numeric: true, sensitivity: 'base' });
    if (compared !== 0) return compared;
  }
  return 0;
}

function collectLeaves(nodes: readonly ApiSidebarNode[]): ApiSidebarNode[] {
  const leaves: ApiSidebarNode[] = [];
  const visit = (items: readonly ApiSidebarNode[]): void => {
    for (const item of items) {
      if (item.module && item.kind && item.link) leaves.push(item);
      if (item.items) visit(item.items);
    }
  };
  visit(nodes);
  return leaves;
}

function uniqueLeaves(nodes: readonly ApiSidebarNode[]): ApiSidebarNode[] {
  const byLink = new Map<string, ApiSidebarNode>();
  for (const node of nodes) {
    if (node.link && !byLink.has(node.link)) byLink.set(node.link, node);
  }
  return [...byLink.values()].sort((a, b) =>
    (a.link ?? '').localeCompare(b.link ?? '', 'en', { numeric: true, sensitivity: 'base' }));
}

function kindSections(leaves: readonly ApiSidebarNode[]): ApiSidebarNode[] {
  const sections: ApiSidebarNode[] = [];
  for (const [kind, text] of KIND_LABELS) {
    const items = uniqueLeaves(leaves.filter((leaf) => leaf.kind === kind));
    if (items.length > 0) sections.push({ text, section: true, items });
  }
  return sections;
}

function nestedLabel(parent: string, child: string): string {
  return child.startsWith(`${parent}.`) ? child.slice(parent.length + 1) : child;
}

/** Hashed chunk files that hold leaves for the given module rows. */
export function packageChunks(
  modules: readonly PackageSidebarModule[],
  skeleton: readonly ApiSidebarNode[],
): string[] {
  const stems = new Set(modules.flatMap((module) => module.sectionStems));
  const chunks = skeleton.flatMap((root) => root.items ?? [])
    .filter((section) => section.chunk && section.modules?.some((stem) => stems.has(stem)))
    .map((section) => section.chunk!);
  return [...new Set(chunks)].sort();
}

/** Regroup the existing service chunks into the package view without generating a second tree. */
export function buildPackageSidebar(
  modules: readonly PackageSidebarModule[],
  skeleton: readonly ApiSidebarNode[],
  loadedChunks: ReadonlyMap<string, readonly ApiSidebarNode[]>,
  apiRoot: string,
): ApiSidebarNode[] {
  const groups = new Map<string, PackageSidebarModule[]>();
  for (const module of modules) {
    const key = packageKey(module);
    const group = groups.get(key) ?? [];
    group.push(module);
    groups.set(key, group);
  }

  const packages = [...groups.entries()]
    .sort(([a], [b]) => compareFqn(a, b))
    .map(([key, members]): ApiSidebarNode => {
      const ordered = [...members].sort((a, b) => compareFqn(a.fqn, b.fqn));
      const main = ordered.find((module) => module.fqn === key) ?? ordered[0];
      const service = ordered.some((module) => module.service);
      const memberNames = new Set(ordered.map((module) => module.fqn));
      const chunks = packageChunks(ordered, skeleton);
      const packageLeaves = chunks
        .flatMap((chunk) => collectLeaves(loadedChunks.get(chunk) ?? []))
        .filter((leaf) => leaf.module && memberNames.has(leaf.module));
      const items: ApiSidebarNode[] = [];
      if (main.overview) items.push({ text: 'Overview', link: main.overview });

      for (const module of ordered) {
        if (module === main || !module.overview) continue;
        const text = service ? module.fqn : nestedLabel(key, module.fqn);
        items.push({ text, section: true, items: [{ text: 'Overview', link: module.overview }] });
      }

      if (service) {
        items.push(...kindSections(packageLeaves));
      } else {
        const rootLeaves = packageLeaves.filter((leaf) => leaf.module === main.fqn);
        items.push(...kindSections(rootLeaves));
        for (const module of ordered) {
          if (module === main) continue;
          const nestedLeaves = packageLeaves.filter((leaf) => leaf.module === module.fqn);
          for (const section of kindSections(nestedLeaves)) {
            items.push({ ...section, text: `${nestedLabel(key, module.fqn)} ${section.text}` });
          }
        }
      }

      const cloudFormationOnly = service && ordered.every((module) => module.cloudFormationOnly);
      return {
        text: cloudFormationOnly ? `${key}¹` : key,
        collapsed: true,
        chunks,
        items,
      };
    });

  return [{ text: 'API Reference', collapsed: true, items: [{ text: 'Overview', link: apiRoot }] }, ...packages];
}
