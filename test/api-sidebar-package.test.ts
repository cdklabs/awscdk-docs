import {
  buildPackageSidebar,
  decodePackageModules,
  packageChunks,
  type PackageSidebarModule,
} from '../docs/.vitepress/theme/api-sidebar-package.js';
import type { ApiSidebarNode } from '../docs/.vitepress/theme/api-sidebar.js';

const moduleInfo = (
  fqn: string,
  overrides: Partial<PackageSidebarModule> = {},
): PackageSidebarModule => ({
  fqn,
  assembly: fqn.split('.')[0],
  service: fqn.includes('.aws_'),
  cloudFormationOnly: false,
  sectionStems: [fqn],
  overview: `/v2/docs/${fqn}-readme`,
  ...overrides,
});

const leaf = (
  text: string,
  module: string,
  kind: ApiSidebarNode['kind'],
): ApiSidebarNode => ({
  text,
  link: `/v2/docs/${module}.${text}`,
  module,
  kind,
});

const links = (nodes: readonly ApiSidebarNode[]): string[] => {
  const out: string[] = [];
  const visit = (items: readonly ApiSidebarNode[]): void => {
    for (const item of items) {
      if (item.link) out.push(item.link);
      if (item.items) visit(item.items);
    }
  };
  visit(nodes);
  return out;
};

const skeleton = (...entries: ReadonlyArray<readonly [string, string]>): ApiSidebarNode[] => [{
  text: 'Services',
  items: entries.map(([stem, chunk]) => ({ text: stem, modules: [stem], chunk })),
}];

describe('package sidebar', () => {
  test('decodes compact module rows from the existing skeleton', () => {
    expect(decodePackageModules([
      '234',
      ['@aws-cdk/aws-only-alpha'],
    ], skeleton(
      ['aws-cdk-lib.aws_s3', 's3.js'],
      ['@aws-cdk_aws-only-alpha', 'only.js'],
      ['aws-cdk-lib.unlisted', 'unlisted.js'],
    ), '/v2/')).toEqual([
      {
        fqn: 'aws-cdk-lib.aws_s3',
        assembly: 'aws-cdk-lib',
        service: true,
        cloudFormationOnly: false,
        overview: '/v2/docs/aws-cdk-lib.aws_s3-readme',
        sectionStems: ['aws-cdk-lib.aws_s3'],
      },
      {
        fqn: '@aws-cdk/aws-only-alpha',
        assembly: '@aws-cdk/aws-only-alpha',
        service: true,
        cloudFormationOnly: true,
        overview: '/v2/docs/@aws-cdk_aws-only-alpha-readme',
        sectionStems: ['@aws-cdk_aws-only-alpha'],
      },
    ]);
  });

  test('starts with the API root and orders aws-cdk-lib modules before other assemblies', () => {
    const modules = [
      moduleInfo('@aws-cdk/aws-glue-alpha', {
        assembly: '@aws-cdk/aws-glue-alpha',
        service: true,
      }),
      moduleInfo('aws-cdk-lib.aws_s3'),
      moduleInfo('aws-cdk-lib', { service: false }),
      moduleInfo('aws-cdk-lib.aws_apigatewayv2'),
    ];

    const tree = buildPackageSidebar(modules, skeleton(), new Map(), '/v2/');

    expect(tree.map((item) => item.text)).toEqual([
      'API Reference',
      'aws-cdk-lib',
      'aws-cdk-lib.aws_apigatewayv2',
      'aws-cdk-lib.aws_s3',
      '@aws-cdk/aws-glue-alpha',
    ]);
    expect(tree[0].items).toEqual([{ text: 'Overview', link: '/v2/' }]);
    expect(tree.slice(1).every((item) => item.collapsed === true)).toBe(true);
  });

  test('groups leaves by kind with facade and trait fallbacks', () => {
    const module = moduleInfo('aws-cdk-lib.aws_s3');
    const chunk = [
      leaf('Bucket', module.fqn, 'construct'),
      leaf('BucketMixin', module.fqn, 'mixin'),
      leaf('BucketGrants', module.fqn, 'class'),
      leaf('BucketProps', module.fqn, 'struct'),
      leaf('IBucket', module.fqn, 'interface'),
      leaf('BucketEncryption', module.fqn, 'enum'),
      leaf('CfnBucket', module.fqn, 'cfn-resource'),
      leaf('CfnBucket.PolicyProperty', module.fqn, 'cfn-property'),
    ];
    const serviceSkeleton = skeleton([module.fqn, 's3.js']);

    expect(packageChunks([module], serviceSkeleton)).toEqual(['s3.js']);
    const tree = buildPackageSidebar(
      [module],
      serviceSkeleton,
      new Map([['s3.js', chunk]]),
      '/v2/',
    );
    const packageNode = tree[1];

    expect(packageNode.chunks).toEqual(['s3.js']);
    expect(packageNode.items!.map((item) => item.text)).toEqual([
      'Overview',
      'Constructs',
      'Mixins',
      'Classes',
      'Structs',
      'Interfaces',
      'Enums',
      'CloudFormation Resources',
      'CloudFormation Property Types',
    ]);
    expect(packageNode.items!.slice(1).every((item) => item.section === true)).toBe(true);
  });

  test('folds deep aws-cdk-lib submodules into their first-level package', () => {
    const parent = moduleInfo('aws-cdk-lib.aws_s3');
    const nested = moduleInfo('aws-cdk-lib.aws_s3.mixins', {
      overview: '/v2/docs/aws-cdk-lib.aws_s3.mixins-readme',
    });
    const serviceSkeleton = skeleton([parent.fqn, 's3.js'], [nested.fqn, 's3.js']);
    const tree = buildPackageSidebar(
      [parent, nested],
      serviceSkeleton,
      new Map([['s3.js', [
        leaf('Bucket', parent.fqn, 'construct'),
        leaf('BucketVersioning', nested.fqn, 'mixin'),
      ]]]),
      '/v2/',
    );

    expect(tree.map((item) => item.text)).toEqual(['API Reference', 'aws-cdk-lib.aws_s3']);
    expect(tree[1].items!.find((item) => item.text === nested.fqn)?.items).toEqual([
      { text: 'Overview', link: nested.overview },
    ]);
    expect(links(tree).filter((link) => link.endsWith('.BucketVersioning'))).toHaveLength(1);
  });

  test('keeps non-service submodules inside one assembly entry', () => {
    const root = moduleInfo('constructs', { assembly: 'constructs', service: false });
    const nested = moduleInfo('constructs.metadata', { assembly: 'constructs', service: false });
    const tree = buildPackageSidebar(
      [root, nested],
      skeleton([root.fqn, 'constructs.js'], [nested.fqn, 'constructs.js']),
      new Map([['constructs.js', [leaf('Construct', root.fqn, 'class'), leaf('Node', nested.fqn, 'class')]]]),
      '/v2/',
    );

    expect(tree.map((item) => item.text)).toEqual(['API Reference', 'constructs']);
    expect(tree[1].items!.map((item) => item.text)).toEqual([
      'Overview',
      'metadata',
      'Classes',
      'metadata Classes',
    ]);
    expect(tree[1].items![1].items).toEqual([{ text: 'Overview', link: nested.overview }]);
  });

  test('marks CloudFormation-only service packages', () => {
    const module = moduleInfo('@aws-cdk/aws-foo-alpha', {
      assembly: '@aws-cdk/aws-foo-alpha',
      service: true,
      cloudFormationOnly: true,
    });
    const tree = buildPackageSidebar([module], skeleton(), new Map(), '/v2/');
    expect(tree[1].text).toBe('@aws-cdk/aws-foo-alpha¹');
  });

  test('keeps every type page exactly once', () => {
    const s3 = moduleInfo('aws-cdk-lib.aws_s3');
    const alpha = moduleInfo('@aws-cdk/aws-glue-alpha', {
      assembly: '@aws-cdk/aws-glue-alpha',
      service: true,
    });
    const chunks = new Map<string, readonly ApiSidebarNode[]>([
      ['s3.js', [leaf('Bucket', s3.fqn, 'construct'), leaf('BucketProps', s3.fqn, 'struct')]],
      ['glue.js', [leaf('Job', alpha.fqn, 'construct')]],
    ]);

    const tree = buildPackageSidebar(
      [s3, alpha],
      skeleton([s3.fqn, 's3.js'], [alpha.fqn, 'glue.js']),
      chunks,
      '/v2/',
    );
    const typeLinks = links(tree).filter((link) => !link.endsWith('-readme') && link !== '/v2/');

    expect(typeLinks.sort()).toEqual([
      '/v2/docs/@aws-cdk/aws-glue-alpha.Job',
      '/v2/docs/aws-cdk-lib.aws_s3.Bucket',
      '/v2/docs/aws-cdk-lib.aws_s3.BucketProps',
    ]);
    expect(new Set(typeLinks).size).toBe(typeLinks.length);
  });
});
