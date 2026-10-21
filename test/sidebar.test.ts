import { assemblyOwner, buildServiceSidebar, CONSTRUCTS_SECTION, frameworkSectionCompare, frameworkSectionName, FRAMEWORK_SECTION, isConstructsPackage, isCore, isServiceSubmodule, resourceStem, sectionName, SERVICES_SECTION, serviceSubmodule, shortTypeName, SidebarEntry, SidebarItem, splitSidebarChunks } from '../src/docgen/sidebar.js';

function entry(overrides: Partial<SidebarEntry>): SidebarEntry {
  return {
    name: 'Thing',
    kind: 'Class',
    assemblyName: 'aws-cdk-lib',
    submodule: 'aws_s3',
    indexLink: '/api/modules/aws-cdk-lib/aws-s3',
    ...overrides,
  };
}

/**
 * Adds a second, unrelated resource to a fixture.
 *
 * A section with at most one resource collapses its resource wrappers
 * away. Tests whose subject is what happens INSIDE a resource
 * group — kind groups, the trailing Others group, leaf labels, ordering,
 * collapsed state — would silently stop exercising that path on a
 * single-resource fixture: they would still pass shapes back, just not the
 * shapes they were written to assert. Wrapping the fixture keeps them on the
 * two-or-more path they describe.
 */
function withSibling(entries: SidebarEntry[]): SidebarEntry[] {
  // TWO siblings, not one: some of these fixtures contribute no resource at
  // all (their subject is types that match none), so a single sibling would
  // still leave the section on the collapsing side of the condition.
  // Inherit the fixture's own module context, or a sibling lands in a
  // DIFFERENT section and the assertions read the wrong one.
  const first = entries[0];
  const sibling = (name: string) =>
    entry({
      assemblyName: first?.assemblyName,
      submodule: first?.submodule,
      indexLink: first?.indexLink,
      name,
      kind: 'Construct (L2)',
      link: `/${name.toLowerCase()}`,
    });
  return [...entries, sibling('Sibling'), sibling('Zzsibling')];
}

/**
 * The service/feature sections across the two top-level Framework /
 * Services groupings, in tree order. Framework precedes Services and Core
 * leads Framework, so the flattened order matches the section order and
 * section-level assertions are unaffected by the grouping level.
 */
function sidebarSections(
  entries: SidebarEntry[],
  languages: Parameters<typeof buildServiceSidebar>[1] = [],
): SidebarItem[] {
  return buildServiceSidebar(entries, languages).flatMap((top) => top.items ?? []);
}

describe('frameworkSectionName', () => {
  test('is the package-qualified module name', () => {
    expect(frameworkSectionName('aws-cdk-lib', 'assertions')).toBe('aws-cdk-lib.assertions');
    expect(frameworkSectionName('@aws-cdk/app-staging-synthesizer-alpha', '')).toBe(
      '@aws-cdk/app-staging-synthesizer-alpha',
    );
    expect(frameworkSectionName('constructs', '')).toBe('constructs');
  });

  test('Core folds to the bare package name, never a submodule suffix', () => {
    // The Core group holds the '', core and assets submodules; all
    // three label as `aws-cdk-lib`.
    expect(frameworkSectionName('aws-cdk-lib', '')).toBe('aws-cdk-lib');
    expect(frameworkSectionName('aws-cdk-lib', 'core')).toBe('aws-cdk-lib');
    expect(frameworkSectionName('aws-cdk-lib', 'assets')).toBe('aws-cdk-lib');
  });

  test('keeps the scope, the -alpha suffix and the dashes verbatim', () => {
    // assemblyOwner() is lossy in exactly these three ways, so a label
    // routed through it could never be reconstructed.
    expect(assemblyOwner('@aws-cdk/integ-tests-alpha')).toBe('integ_tests');
    expect(frameworkSectionName('@aws-cdk/integ-tests-alpha', '')).toBe('@aws-cdk/integ-tests-alpha');
  });
});

describe('frameworkSectionCompare', () => {
  test('sorts @-scoped package names after unscoped ones', () => {
    // Default string ordering gets this backwards: '@' is U+0040, before 'A'.
    expect('@aws-cdk/integ-tests-alpha'.localeCompare('aws-cdk-lib')).toBeLessThan(0);
    expect(frameworkSectionCompare('@aws-cdk/integ-tests-alpha', 'aws-cdk-lib')).toBeGreaterThan(0);
    expect(frameworkSectionCompare('aws-cdk-lib', '@aws-cdk/integ-tests-alpha')).toBeLessThan(0);
  });

  test('orders unscoped names case-insensitively and numerically', () => {
    expect(
      ['constructs', 'aws-cdk-lib.pipelines', 'aws-cdk-lib', 'aws-cdk-lib.assertions']
        .sort(frameworkSectionCompare),
    ).toEqual(['aws-cdk-lib', 'aws-cdk-lib.assertions', 'aws-cdk-lib.pipelines', 'constructs']);
    // sensitivity: 'base' — case does not reorder neighbors.
    expect(frameworkSectionCompare('aws-cdk-lib.Assertions', 'aws-cdk-lib.assertions')).toBe(0);
    // numeric: true — 'v2' before 'v10'.
    expect(frameworkSectionCompare('pkg.v2', 'pkg.v10')).toBeLessThan(0);
  });

  test('sorts a whole scoped group after the unscoped ones', () => {
    expect(
      [
        '@aws-cdk/integ-tests-alpha',
        'constructs',
        '@aws-cdk/app-staging-synthesizer-alpha',
        'aws-cdk-lib',
      ].sort(frameworkSectionCompare),
    ).toEqual([
      'aws-cdk-lib',
      'constructs',
      '@aws-cdk/app-staging-synthesizer-alpha',
      '@aws-cdk/integ-tests-alpha',
    ]);
  });
});

describe('sectionName', () => {
  test('maps aws_ submodules to service names', () => {
    expect(sectionName('aws_s3')).toBe('S3');
    expect(sectionName('aws_lambda')).toBe('Lambda');
    expect(sectionName('aws_dynamodb')).toBe('DynamoDB');
    expect(sectionName('aws_iam')).toBe('IAM');
    expect(sectionName('aws_stepfunctions')).toBe('Step Functions');
  });

  test('folds integration submodules into their service', () => {
    expect(sectionName('aws_s3_deployment')).toBe('S3');
    expect(sectionName('aws_lambda_event_sources')).toBe('Lambda');
    expect(sectionName('aws_stepfunctions_tasks')).toBe('Step Functions');
  });

  test('title-cases non-service submodules without folding', () => {
    expect(sectionName('custom_resources')).toBe('Custom Resources');
    expect(sectionName('pipelines')).toBe('Pipelines');
    expect(sectionName('region_info')).toBe('Region Info');
  });

  test('service names are correctly capitalized and spaced', () => {
    // The one the issue calls out, plus known mis-casings the naive
    // title-case heuristic produced.
    expect(sectionName('aws_amazonmq')).toBe('Amazon MQ');
    expect(sectionName('aws_docdb')).toBe('DocDB');
    expect(sectionName('aws_elasticache')).toBe('ElastiCache');
    expect(sectionName('aws_globalaccelerator')).toBe('Global Accelerator');
    expect(sectionName('aws_sagemaker')).toBe('SageMaker');
    expect(sectionName('aws_quicksight')).toBe('QuickSight');
    // Mixed-case acronyms the <=3-chars-uppercase rule gets wrong.
    expect(sectionName('aws_iot')).toBe('IoT');
    expect(sectionName('aws_iotsitewise')).toBe('IoT SiteWise');
    expect(sectionName('aws_fsx')).toBe('FSx');
    expect(sectionName('aws_lex')).toBe('Lex');
    // Already-correct names stay as they were.
    expect(sectionName('alexa_ask')).toBe('Alexa ASK');
  });

  test('lambda_layer_* packages fold into the Lambda service', () => {
    expect(sectionName('lambda_layer_awscli')).toBe('Lambda');
    expect(sectionName('lambda_layer_node_proxy_agent')).toBe('Lambda');
  });
});

describe('serviceSubmodule', () => {
  test('strips the interfaces mirror prefix to the owning service', () => {
    expect(serviceSubmodule('interfaces.aws_s3')).toBe('aws_s3');
    expect(serviceSubmodule('interfaces.aws_lambda')).toBe('aws_lambda');
    expect(serviceSubmodule('interfaces.alexa_ask')).toBe('alexa_ask');
  });

  test('the bare interfaces submodule folds to the module root', () => {
    expect(serviceSubmodule('interfaces')).toBe('');
  });

  test('strips the per-service mixins suffix to the owning service', () => {
    expect(serviceSubmodule('aws_s3.mixins')).toBe('aws_s3');
    expect(serviceSubmodule('aws_ecs.mixins')).toBe('aws_ecs');
  });

  test('the bare mixins submodule folds to the module root', () => {
    expect(serviceSubmodule('mixins')).toBe('');
  });

  test('service and feature submodules pass through unchanged', () => {
    expect(serviceSubmodule('aws_s3')).toBe('aws_s3');
    expect(serviceSubmodule('aws_s3_deployment')).toBe('aws_s3_deployment');
    expect(serviceSubmodule('custom_resources')).toBe('custom_resources');
    expect(serviceSubmodule('')).toBe('');
  });

  test('does not strip an interfaces-like prefix that is a real name part', () => {
    // Only the exact structural segment counts, not substrings.
    expect(serviceSubmodule('interfaces_v2')).toBe('interfaces_v2');
    expect(serviceSubmodule('aws_mixinsvc')).toBe('aws_mixinsvc');
  });
});

describe('isCore', () => {
  test('the constructs package is its own section, not Core', () => {
    expect(isCore('constructs', '')).toBe(false);
    expect(isConstructsPackage('constructs')).toBe(true);
    expect(isConstructsPackage('aws-cdk-lib')).toBe(false);
  });

  test('module root, core, and assets submodules are core', () => {
    expect(isCore('aws-cdk-lib', '')).toBe(true);
    expect(isCore('aws-cdk-lib', 'core')).toBe(true);
    expect(isCore('aws-cdk-lib', 'assets')).toBe(true);
  });

  test('service submodules are not core', () => {
    expect(isCore('aws-cdk-lib', 'aws_s3')).toBe(false);
  });

  test('standalone package root is not core', () => {
    expect(isCore('some-standalone-pkg', '')).toBe(false);
  });
});

describe('resourceStem', () => {
  test('construct names are their own stem', () => {
    expect(resourceStem('Bucket')).toBe('Bucket');
    expect(resourceStem('BucketPolicy')).toBe('BucketPolicy');
  });

  test('strips the Cfn L1 prefix', () => {
    expect(resourceStem('CfnBucket')).toBe('Bucket');
    expect(resourceStem('CfnBucketProps')).toBe('Bucket');
  });

  test('strips the I interface prefix', () => {
    expect(resourceStem('IBucket')).toBe('Bucket');
    expect(resourceStem('IQueue')).toBe('Queue');
  });

  test('does not strip a leading I followed by lowercase', () => {
    expect(resourceStem('Instance')).toBe('Instance');
    expect(resourceStem('IpAddresses')).toBe('IpAddresses');
  });

  test('strips the Props suffix', () => {
    expect(resourceStem('BucketProps')).toBe('Bucket');
    expect(resourceStem('BucketPolicyProps')).toBe('BucketPolicy');
  });

  test('nested type names stem from their owner', () => {
    expect(resourceStem('CfnBucket.PolicyProperty')).toBe('Bucket');
  });

  test('does not strip when the whole name would vanish', () => {
    expect(resourceStem('Props')).toBe('Props');
  });
});

describe('shortTypeName', () => {
  test('plain names pass through', () => {
    expect(shortTypeName('Bucket')).toBe('Bucket');
    expect(shortTypeName('IBucket')).toBe('IBucket');
  });

  test('nested names shorten to their last segment', () => {
    expect(shortTypeName('CfnBucket.PolicyProperty')).toBe('PolicyProperty');
    expect(shortTypeName('A.B.C')).toBe('C');
  });
});

describe('isServiceSubmodule', () => {
  test('aws_ submodules are services', () => {
    expect(isServiceSubmodule('aws_s3')).toBe(true);
    expect(isServiceSubmodule('aws_lambda')).toBe(true);
    expect(isServiceSubmodule('aws_s3_deployment')).toBe(true);
  });

  test('vendored alexa_ service bindings are services', () => {
    expect(isServiceSubmodule('alexa_ask')).toBe(true);
  });

  test('lambda_layer_* packages count as services', () => {
    expect(isServiceSubmodule('lambda_layer_awscli')).toBe(true);
    expect(isServiceSubmodule('lambda_layer_node_proxy_agent')).toBe(true);
  });

  test('framework feature submodules are not services', () => {
    expect(isServiceSubmodule('assertions')).toBe(false);
    expect(isServiceSubmodule('custom_resources')).toBe(false);
    expect(isServiceSubmodule('cx_api')).toBe(false);
    expect(isServiceSubmodule('pipelines')).toBe(false);
    expect(isServiceSubmodule('region_info')).toBe(false);
    expect(isServiceSubmodule('cloud_assembly_schema')).toBe(false);
    expect(isServiceSubmodule('triggers')).toBe(false);
  });

  test('the module root is not a service', () => {
    expect(isServiceSubmodule('')).toBe(false);
  });
});

describe('assemblyOwner', () => {
  test('derives a service owner for aws-* alpha packages', () => {
    expect(assemblyOwner('@aws-cdk/aws-lambda-python-alpha')).toBe('aws_lambda_python');
    expect(assemblyOwner('@aws-cdk/aws-bedrock-alpha')).toBe('aws_bedrock');
    expect(isServiceSubmodule(assemblyOwner('@aws-cdk/aws-glue-alpha'))).toBe(true);
  });

  test('derives a framework owner for non-service packages', () => {
    expect(assemblyOwner('@aws-cdk/integ-tests-alpha')).toBe('integ_tests');
    expect(assemblyOwner('@aws-cdk/cloud-assembly-schema')).toBe('cloud_assembly_schema');
    expect(isServiceSubmodule(assemblyOwner('@aws-cdk/cloud-assembly-schema'))).toBe(false);
  });

  test('aws-cdk-lib maps to the empty owner so its root types stay Core', () => {
    expect(assemblyOwner('aws-cdk-lib')).toBe('');
  });

  test('alpha service packages fold into the same Services section as the stable submodule', () => {
    const sidebar = buildServiceSidebar([
      entry({ submodule: 'aws_lambda', indexLink: '/api/modules/ts/aws-cdk-lib/aws-lambda' }),
      entry({
        name: 'PythonFunction',
        assemblyName: '@aws-cdk/aws-lambda-python-alpha',
        submodule: '',
        indexLink: '/api/modules/ts/aws-cdk-aws-lambda-python-alpha/',
      }),
    ]);
    expect(sidebar.map((s) => s.text)).toEqual([SERVICES_SECTION]);
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['Lambda']);
    // Both packages contribute an Overview leaf to the shared section.
    const overviews = sidebar[0].items![0].items!.filter((i) => i.text.startsWith('Overview'));
    expect(overviews.map((i) => i.link).sort()).toEqual([
      '/api/modules/ts/aws-cdk-aws-lambda-python-alpha/',
      '/api/modules/ts/aws-cdk-lib/aws-lambda',
    ]);
  });

  test('a standalone service package\'s bare mixins submodule folds into its Services section', () => {
    const sidebar = buildServiceSidebar([
      entry({
        name: 'KnowledgeBaseEmbeddingsModel',
        kind: 'Mixin',
        assemblyName: '@aws-cdk/aws-bedrock-alpha',
        submodule: 'mixins',
        indexLink: '/api/modules/ts/aws-cdk-aws-bedrock-alpha/mixins',
      }),
    ]);
    expect(sidebar.map((s) => s.text)).toEqual([SERVICES_SECTION]);
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['Bedrock']);
  });

  test('standalone non-service packages become their own Framework section', () => {
    const sidebar = buildServiceSidebar([
      entry({
        name: 'RunnerImage',
        assemblyName: '@aws-cdk/cloud-assembly-schema',
        submodule: '',
        indexLink: '/api/modules/ts/aws-cdk-cloud-assembly-schema/',
      }),
    ]);
    expect(sidebar.map((s) => s.text)).toEqual([FRAMEWORK_SECTION]);
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['@aws-cdk/cloud-assembly-schema']);
  });
});

describe('buildServiceSidebar', () => {
  test('partitions the nav into Framework and Services top-level sections', () => {
    const sidebar = buildServiceSidebar([
      entry({ submodule: 'aws_sqs', indexLink: '/api/modules/aws-cdk-lib/aws-sqs' }),
      entry({ submodule: 'aws_lambda', indexLink: '/api/modules/aws-cdk-lib/aws-lambda' }),
      entry({ submodule: 'pipelines', indexLink: '/api/modules/aws-cdk-lib/pipelines' }),
      entry({ assemblyName: 'constructs', submodule: '', indexLink: '/api/modules/constructs/' }),
    ]);
    expect(sidebar.map((s) => s.text)).toEqual([FRAMEWORK_SECTION, SERVICES_SECTION]);
    // Framework headings are package-qualified and alphabetical, so
    // `constructs` follows `aws-cdk-lib.pipelines`.
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['aws-cdk-lib.pipelines', CONSTRUCTS_SECTION]);
    // Services stay alphabetical.
    expect(sidebar[1].items!.map((s) => s.text)).toEqual(['Lambda', 'SQS']);
  });

  test('Framework and Services are fixed non-collapsible sections', () => {
    const sidebar = buildServiceSidebar([
      entry({ submodule: 'aws_sqs', indexLink: '/api/modules/aws-cdk-lib/aws-sqs' }),
      entry({ assemblyName: 'constructs', submodule: '', indexLink: '/api/modules/constructs/' }),
    ]);
    for (const top of sidebar) {
      // Structural headers, rendered non-collapsible by the theme;
      // collapsed:false is kept for backward compatibility.
      expect(top.section).toBe(true);
      expect(top.collapsed).toBe(false);
      for (const section of top.items!) {
        expect(section.section).toBeUndefined();
        expect(section.collapsed).toBe(true);
      }
    }
  });

  test('the constructs package gets its own kind-grouped Framework section', () => {
    const sidebar = buildServiceSidebar([
      entry({
        name: 'Stack',
        kind: 'Construct',
        assemblyName: 'aws-cdk-lib',
        submodule: '',
        link: '/api/modules/aws-cdk-lib/core/stack',
        indexLink: '/api/modules/aws-cdk-lib/',
      }),
      entry({
        name: 'Construct',
        kind: 'Construct',
        assemblyName: 'constructs',
        submodule: '',
        link: '/api/modules/constructs/core/construct',
        indexLink: '/api/modules/constructs/',
      }),
      entry({
        name: 'IConstruct',
        kind: 'Interface',
        assemblyName: 'constructs',
        submodule: '',
        link: '/api/modules/constructs/core/iconstruct',
        indexLink: '/api/modules/constructs/',
      }),
    ]);
    // Core leads (as `aws-cdk-lib`), constructs follows as its own section.
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['aws-cdk-lib', CONSTRUCTS_SECTION]);
    const constructs = sidebar[0].items![1];
    // Flat kind grouping like Core — not resource groups.
    expect(constructs.items!.map((g) => g.text)).toEqual(['Overview', 'Constructs', 'Others']);
  });

  test('lambda_layer_* packages land under the Lambda service', () => {
    const sidebar = buildServiceSidebar([
      entry({
        name: 'Function',
        kind: 'Construct (L2)',
        submodule: 'aws_lambda',
        link: '/api/modules/aws-cdk-lib/aws-lambda/function',
        indexLink: '/api/modules/aws-cdk-lib/aws-lambda',
      }),
      entry({
        name: 'AwsCliLayer',
        kind: 'Construct (L2)',
        submodule: 'lambda_layer_awscli',
        link: '/api/modules/aws-cdk-lib/lambda-layer-awscli/awsclilayer',
        indexLink: '/api/modules/aws-cdk-lib/lambda-layer-awscli',
      }),
    ]);
    // Not in Framework: both live under Services -> Lambda.
    expect(sidebar.map((s) => s.text)).toEqual([SERVICES_SECTION]);
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['Lambda']);
    const lambda = sidebar[0].items![0];
    // The layer package keeps its own Overview link and its resource.
    expect(lambda.items!.slice(0, 2).map((i) => i.text)).toEqual([
      'Overview (aws_lambda)',
      'Overview (lambda_layer_awscli)',
    ]);
    const resources = lambda.items!.filter((i) => i.items).map((i) => i.text);
    expect(resources).toEqual(['AwsCliLayer', 'Function']);
  });

  test('omits an empty top-level grouping', () => {
    const servicesOnly = buildServiceSidebar([entry({})]);
    expect(servicesOnly.map((s) => s.text)).toEqual([SERVICES_SECTION]);
    const frameworkOnly = buildServiceSidebar([
      entry({ assemblyName: 'constructs', submodule: '', indexLink: '/api/modules/constructs/' }),
    ]);
    expect(frameworkOnly.map((s) => s.text)).toEqual([FRAMEWORK_SECTION]);
  });

  test('no module is dropped or duplicated by the partition', () => {
    const sidebar = buildServiceSidebar([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
      entry({
        name: 'Pipeline',
        kind: 'Construct (L2)',
        submodule: 'pipelines',
        link: '/pipeline',
        indexLink: '/api/modules/aws-cdk-lib/pipelines',
      }),
    ]);
    const leaves: string[] = [];
    const walk = (items: readonly SidebarItem[]) => {
      for (const item of items) {
        if (item.link && !item.items) leaves.push(item.link);
        if (item.items) walk(item.items);
      }
    };
    walk(sidebar);
    // Each type page appears exactly once, with its canonical URL untouched.
    expect(leaves.filter((l) => l === '/bucket')).toHaveLength(1);
    expect(leaves.filter((l) => l === '/pipeline')).toHaveLength(1);
  });

  test('a structural submodule of a service stays in Services after rollup', () => {
    const sidebar = buildServiceSidebar([
      entry({
        name: 'IBucketRef',
        kind: 'Interface',
        submodule: 'interfaces.aws_s3',
        link: '/api/modules/aws-cdk-lib/interfaces-aws-s3/ibucket-ref',
        indexLink: '/api/modules/aws-cdk-lib/interfaces-aws-s3',
      }),
    ]);
    // Classification happens on the OWNER submodule (aws_s3), not the
    // structural name — so the type lands under Services -> S3.
    expect(sidebar.map((s) => s.text)).toEqual([SERVICES_SECTION]);
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['S3']);
  });

  test('pins the full Framework heading order: unscoped alphabetical, @-scoped last', () => {
    const sidebar = buildServiceSidebar([
      entry({ submodule: 'aws_sqs', indexLink: '/api/modules/aws-cdk-lib/aws-sqs' }),
      entry({ submodule: 'aws_lambda', indexLink: '/api/modules/aws-cdk-lib/aws-lambda' }),
      entry({ assemblyName: 'aws-cdk-lib', submodule: '', indexLink: '/api/modules/aws-cdk-lib/' }),
      entry({ assemblyName: 'aws-cdk-lib', submodule: 'assertions', indexLink: '/api/modules/aws-cdk-lib/assertions' }),
      entry({ assemblyName: 'aws-cdk-lib', submodule: 'pipelines', indexLink: '/api/modules/aws-cdk-lib/pipelines' }),
      entry({ assemblyName: 'constructs', submodule: '', indexLink: '/api/modules/constructs/' }),
      entry({
        assemblyName: '@aws-cdk/app-staging-synthesizer-alpha',
        submodule: '',
        indexLink: '/api/modules/aws-cdk-app-staging-synthesizer-alpha/',
      }),
      entry({
        assemblyName: '@aws-cdk/integ-tests-alpha',
        submodule: '',
        indexLink: '/api/modules/aws-cdk-integ-tests-alpha/',
      }),
    ]);
    // The CORE_SECTION rank-0 and CONSTRUCTS_SECTION rank-1 pins are
    // gone: `aws-cdk-lib` leads because it sorts first, and `constructs`
    // follows the `aws-cdk-lib.*` submodules instead of preceding them.
    expect(sidebar[0].items!.map((s) => s.text)).toEqual([
      'aws-cdk-lib',
      'aws-cdk-lib.assertions',
      'aws-cdk-lib.pipelines',
      'constructs',
      '@aws-cdk/app-staging-synthesizer-alpha',
      '@aws-cdk/integ-tests-alpha',
    ]);
    // Services headings and their ordering are unaffected.
    expect(sidebar[1].items!.map((s) => s.text)).toEqual(['Lambda', 'SQS']);
  });

  test('Services headings keep the service-name heuristic and its ordering', () => {
    const sidebar = buildServiceSidebar([
      entry({ submodule: 'aws_apigatewayv2', indexLink: '/api/modules/aws-cdk-lib/aws-apigatewayv2' }),
      entry({ submodule: 'aws_s3', indexLink: '/api/modules/aws-cdk-lib/aws-s3' }),
      entry({ submodule: 'aws_dynamodb', indexLink: '/api/modules/aws-cdk-lib/aws-dynamodb' }),
      entry({ submodule: 'aws_stepfunctions_tasks', indexLink: '/api/modules/aws-cdk-lib/aws-stepfunctions-tasks' }),
    ]);
    expect(sidebar.map((s) => s.text)).toEqual([SERVICES_SECTION]);
    expect(sidebar[0].items!.map((s) => s.text)).toEqual([
      'API Gateway V2',
      'DynamoDB',
      'S3',
      'Step Functions',
    ]);
  });

  test('structural interfaces.* and *.mixins produce no Framework heading of their own', () => {
    const sidebar = buildServiceSidebar([
      entry({
        name: 'Stack',
        kind: 'Construct',
        assemblyName: 'aws-cdk-lib',
        submodule: '',
        indexLink: '/api/modules/aws-cdk-lib/',
      }),
      entry({
        name: 'IStackRef',
        kind: 'Interface',
        assemblyName: 'aws-cdk-lib',
        submodule: 'interfaces',
        indexLink: '/api/modules/aws-cdk-lib/interfaces',
      }),
      entry({
        name: 'ITemplate',
        kind: 'Interface',
        assemblyName: 'aws-cdk-lib',
        submodule: 'interfaces.assertions',
        indexLink: '/api/modules/aws-cdk-lib/interfaces-assertions',
      }),
      entry({
        name: 'IMatcherMixin',
        kind: 'Mixin',
        assemblyName: 'aws-cdk-lib',
        submodule: 'assertions.mixins',
        indexLink: '/api/modules/aws-cdk-lib/assertions-mixins',
      }),
    ]);
    // `interfaces` resolves to the module root, so it joins Core's
    // `aws-cdk-lib` heading; `interfaces.assertions` and
    // `assertions.mixins` both resolve to the `assertions` owner. No
    // `aws-cdk-lib.interfaces` or `aws-cdk-lib.assertions.mixins`.
    expect(sidebar[0].items!.map((s) => s.text)).toEqual(['aws-cdk-lib', 'aws-cdk-lib.assertions']);
  });

  test('puts Core first, then constructs, then services alphabetically', () => {
    const sidebar = sidebarSections([
      entry({ submodule: 'aws_sqs', indexLink: '/api/modules/aws-cdk-lib/aws-sqs' }),
      entry({ submodule: 'aws_lambda', indexLink: '/api/modules/aws-cdk-lib/aws-lambda' }),
      entry({ assemblyName: 'aws-cdk-lib', submodule: '', indexLink: '/api/modules/aws-cdk-lib/' }),
      entry({ assemblyName: 'constructs', submodule: '', indexLink: '/api/modules/constructs/' }),
    ]);
    expect(sidebar.map((s) => s.text)).toEqual(['aws-cdk-lib', CONSTRUCTS_SECTION, 'Lambda', 'SQS']);
  });

  test('groups a service by resource with constructs flat and kinds behind it', () => {
    // Two resources: this test is about the resource WRAPPER and its
    // internals, and a section with one resource collapses the wrapper away,
    // so a single-resource fixture would not exercise the path being
    // asserted.
    const sidebar = sidebarSections([
      entry({ name: 'BucketProps', kind: 'Struct', link: '/api/modules/aws-cdk-lib/aws-s3/bucket-props' }),
      entry({ name: 'IBucketMixin', kind: 'Mixin', link: '/api/modules/aws-cdk-lib/aws-s3/ibucket-mixin' }),
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/api/modules/aws-cdk-lib/aws-s3/bucket' }),
      entry({ name: 'Queue', kind: 'Construct (L2)', link: '/api/modules/aws-cdk-lib/aws-s3/queue' }),
    ]);
    expect(sidebar).toHaveLength(1);
    expect(sidebar[0].items!.map((g) => g.text)).toEqual(['Overview', 'Bucket', 'Queue']);
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    // The construct type is listed directly — no "Constructs" heading —
    // followed by the remaining kind groups.
    expect(bucket.items!.map((g) => g.text)).toEqual(['Bucket', 'Mixins', 'Others']);
    expect(bucket.items![0].link).toBe('/api/modules/aws-cdk-lib/aws-s3/bucket');
    expect(bucket.items![0].items).toBeUndefined();
  });

  test('splits facades and traits into their own kind groups', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
      entry({ name: 'IBucketMixin', kind: 'Mixin', link: '/ibucket-mixin' }),
      entry({ name: 'BucketGrants', kind: 'Facade', link: '/bucket-grants' }),
      entry({ name: 'BucketMetrics', kind: 'Facade', link: '/bucket-metrics' }),
      entry({ name: 'BucketProps', kind: 'Struct', link: '/bucket-props' }),
    ]));
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    // Constructs flat first, then the building-block order
    // per the design guidelines: Mixins, Facades, (Traits,) Others.
    expect(bucket.items!.map((g) => g.text)).toEqual(['Bucket', 'Mixins', 'Facades', 'Others']);
    const facades = bucket.items!.find((g) => g.text === 'Facades')!;
    expect(facades.items!.map((i) => i.text)).toEqual(['BucketGrants', 'BucketMetrics']);
    // Facades do not leak into Others.
    const others = bucket.items!.find((g) => g.text === 'Others')!;
    expect(others.items!.map((i) => i.text)).toEqual(['BucketProps']);
  });

  test('trait interfaces and factories group under Traits', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ submodule: 'aws_iam', name: 'Role', kind: 'Construct (L2)', link: '/role' }),
      entry({ submodule: 'aws_iam', name: 'IResourceWithPolicyV2', kind: 'Trait', link: '/irwp' }),
      entry({ submodule: 'aws_iam', name: 'IResourcePolicyFactory', kind: 'Trait', link: '/irpf' }),
    ]));
    // Traits are service-agnostic: their stems match no resource, so
    // they land in the service-level General group, under Traits.
    const general = sidebar[0].items!.find((g) => g.text === 'General')!;
    expect(general.items!.map((g) => g.text)).toEqual(['Traits']);
    const traits = general.items!.find((g) => g.text === 'Traits')!;
    expect(traits.items!.map((i) => i.text)).toEqual(['IResourcePolicyFactory', 'IResourceWithPolicyV2']);
  });

  test('empty Facades and Traits groups are omitted', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
      entry({ name: 'IBucket', kind: 'Interface', link: '/ibucket' }),
    ]));
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    expect(bucket.items!.map((g) => g.text)).toEqual(['Bucket', 'Others']);
  });

  test('associates related types with their resource', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
      entry({ name: 'BucketProps', kind: 'Struct', link: '/bucket-props' }),
      entry({ name: 'IBucket', kind: 'Interface', link: '/ibucket' }),
      entry({ name: 'BucketEncryption', kind: 'Enum', link: '/bucket-encryption' }),
    ]));
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    const others = bucket.items!.find((g) => g.text === 'Others')!;
    expect(others.items!.map((i) => i.text)).toEqual(['BucketEncryption', 'BucketProps', 'IBucket']);
  });

  test('pairs L1 and L2 constructs directly under the same resource', () => {
    // Both share the stem `Bucket`, so this fixture has ONE resource by
    // construction and would collapse; the siblings keep the
    // wrapper this test is about.
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'CfnBucket', kind: 'Construct (L1)', link: '/cfn-bucket' }),
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
    ]));
    expect(sidebar[0].items!.map((g) => g.text)).toEqual(['Overview', 'Bucket', 'Sibling', 'Zzsibling']);
    // Both constructs sit flat inside the resource, sorted.
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    expect(bucket.items!.map((i) => i.text)).toEqual(['Bucket', 'CfnBucket']);
    expect(bucket.items!.every((i) => i.link && !i.items)).toBe(true);
  });

  test('attaches a type to the longest matching resource', () => {
    const sidebar = sidebarSections([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
      entry({ name: 'BucketPolicy', kind: 'Construct (L2)', link: '/bucket-policy' }),
      entry({ name: 'BucketPolicyProps', kind: 'Struct', link: '/bucket-policy-props' }),
    ]);
    const resources = sidebar[0].items!;
    expect(resources.map((g) => g.text)).toEqual(['Overview', 'Bucket', 'BucketPolicy']);
    const policy = resources.find((g) => g.text === 'BucketPolicy')!;
    const others = policy.items!.find((g) => g.text === 'Others')!;
    expect(others.items!.map((i) => i.text)).toEqual(['BucketPolicyProps']);
  });

  test('types matching no resource fall into a General group', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
      entry({ name: 'StorageClass', kind: 'Enum', link: '/storage-class' }),
    ]));
    const resources = sidebar[0].items!;
    expect(resources.map((g) => g.text)).toEqual([
      'Overview', 'Bucket', 'Sibling', 'Zzsibling', 'General',
    ]);
    const general = resources.find((g) => g.text === 'General')!;
    const others = general.items!.find((g) => g.text === 'Others')!;
    expect(others.items!.map((i) => i.text)).toEqual(['StorageClass']);
  });

  describe('sections with at most one resource collapse the wrapper', () => {
    test('a single resource is listed directly, with its other kinds behind it', () => {
      // The wrapper restated the section name and buried the section's only
      // construct behind a click.
      const sidebar = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
        entry({ name: 'BucketProps', kind: 'Struct', link: '/bucket-props' }),
        entry({ name: 'StorageClass', kind: 'Enum', link: '/storage-class' }),
      ]);
      expect(sidebar[0].items!.map((g) => g.text)).toEqual(['Overview', 'Bucket', 'Others']);
      const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
      expect(bucket.link).toBe('/bucket');
      expect(bucket.items).toBeUndefined();
      // Unmatched types join the kind groups directly — with no resource
      // wrapper there is nothing for a General group to sit beside.
      const others = sidebar[0].items!.find((g) => g.text === 'Others')!;
      expect(others.items!.map((i) => i.text)).toEqual(['BucketProps', 'StorageClass']);
    });

    test('a section with no resource at all collapses too', () => {
      // The zero-resource case is the same condition: a section whose only
      // group would be a `General` one, restating nothing.
      const sidebar = sidebarSections([
        entry({ name: 'Matcher', kind: 'Class', link: '/matcher' }),
        entry({ name: 'Template', kind: 'Class', link: '/template' }),
      ]);
      expect(sidebar[0].items!.map((g) => g.text)).toEqual(['Overview', 'Others']);
      const others = sidebar[0].items!.find((g) => g.text === 'Others')!;
      expect(others.items!.map((i) => i.text)).toEqual(['Matcher', 'Template']);
    });

    test('kind groups carry a marker, so styling never depends on depth', () => {
      // The theme de-emphasizes kind groups. A depth of three would be the
      // obvious key, but it stops meaning "kind group" as soon as the wrapper
      // collapses, so the marker travels with the group instead.
      const collapsed = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
        entry({ name: 'BucketProps', kind: 'Struct', link: '/bucket-props' }),
      ]);
      const shallow = collapsed[0].items!.find((g) => g.text === 'Others')!;
      expect(shallow.kindGroup).toBe(true);

      const wrapped = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
        entry({ name: 'BucketProps', kind: 'Struct', link: '/bucket-props' }),
        entry({ name: 'Queue', kind: 'Construct (L2)', link: '/queue' }),
      ]);
      const deep = wrapped[0].items!.find((g) => g.text === 'Bucket')!
        .items!.find((g) => g.text === 'Others')!;
      expect(deep.kindGroup).toBe(true);

      // A resource wrapper is NOT a kind group, or it would be de-emphasized.
      expect(wrapped[0].items!.find((g) => g.text === 'Bucket')!.kindGroup).toBeUndefined();
    });

    test('two resources keep their wrappers', () => {
      // The boundary: the collapse must not reach a section that genuinely
      // has more than one resource to distinguish.
      const sidebar = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
        entry({ name: 'Queue', kind: 'Construct (L2)', link: '/queue' }),
      ]);
      expect(sidebar[0].items!.map((g) => g.text)).toEqual(['Overview', 'Bucket', 'Queue']);
      expect(sidebar[0].items!.find((g) => g.text === 'Bucket')!.items!.map((i) => i.text))
        .toEqual(['Bucket']);
    });
  });

  test('sorts resources alphabetically with General last', () => {
    const sidebar = sidebarSections([
      entry({ name: 'Queue', kind: 'Construct (L2)', link: '/queue' }),
      entry({ name: 'DeadLetterQueue', kind: 'Construct (L2)', link: '/dlq' }),
      entry({ name: 'Unrelated', kind: 'Class', link: '/unrelated' }),
    ]);
    expect(sidebar[0].items!.map((g) => g.text)).toEqual(['Overview', 'DeadLetterQueue', 'Queue', 'General']);
  });

  test('merges types from different packages into the same section', () => {
    const sidebar = sidebarSections([
      entry({
        name: 'FancyBucket',
        kind: 'Construct (L3)',
        assemblyName: '@aws-cdk/cfn-property-mixins',
        submodule: 'aws_s3',
        link: '/v2/docs/@aws-cdk_cfn-property-mixins.aws_s3.FancyBucket',
        indexLink: '/v2/docs/@aws-cdk_cfn-property-mixins.aws_s3-readme',
      }),
      entry({
        name: 'Bucket',
        kind: 'Construct (L2)',
        assemblyName: 'aws-cdk-lib',
        submodule: 'aws_s3',
        link: '/v2/docs/aws-cdk-lib.aws_s3.Bucket',
        indexLink: '/v2/docs/aws-cdk-lib.aws_s3-readme',
      }),
    ]);
    expect(sidebar).toHaveLength(1);
    expect(sidebar[0].text).toBe('S3');
    expect(sidebar[0].items!.map((g) => g.text)).toEqual([
      'Overview',
      'Overview (@aws-cdk/cfn-property-mixins/aws_s3)',
      'Bucket',
      'FancyBucket',
    ]);
  });

  test('sections, resource groups, and kind headings all start collapsed', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/x' }),
      entry({ name: 'BucketProps', kind: 'Struct', link: '/y' }),
    ]));
    expect(sidebar[0].collapsed).toBe(true);
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    expect(bucket.collapsed).toBe(true);
    // Expanding a resource shows its constructs directly; the remaining
    // kind groups are hidden by default behind their own collapse.
    for (const kindGroup of bucket.items!.filter((g) => g.items)) {
      expect(kindGroup.collapsed).toBe(true);
    }
  });

  test('Core keeps its flat kind grouping with collapsed headings', () => {
    const sidebar = sidebarSections([
      entry({
        name: 'Stack',
        kind: 'Construct',
        assemblyName: 'aws-cdk-lib',
        submodule: '',
        link: '/api/modules/aws-cdk-lib/core/stack',
        indexLink: '/api/modules/aws-cdk-lib/',
      }),
      entry({
        name: 'StackProps',
        kind: 'Struct',
        assemblyName: 'aws-cdk-lib',
        submodule: '',
        link: '/api/modules/aws-cdk-lib/core/stack-props',
        indexLink: '/api/modules/aws-cdk-lib/',
      }),
    ]);
    // Core's heading is the bare package name.
    expect(sidebar[0].text).toBe('aws-cdk-lib');
    const groups = sidebar[0].items!;
    expect(groups.map((g: SidebarItem) => g.text)).toEqual(['Overview', 'Constructs', 'Others']);
    for (const group of groups.filter((g: SidebarItem) => g.items)) {
      expect(group.collapsed).toBe(true);
    }
  });

  test('Others links dedicated pages when present and falls back to the type index', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'BucketProps', kind: 'Struct' }),
      entry({ name: 'BucketEncryption', kind: 'Enum' }),
      entry({ name: 'IBucket', kind: 'Interface', link: '/api/modules/aws-cdk-lib/aws-s3/ibucket' }),
    ]));
    const general = sidebar[0].items!.find((g) => g.text === 'General')!;
    const others = general.items!.find((g) => g.text === 'Others')!;
    expect(others.items).toEqual([
      { text: 'IBucket', link: '/api/modules/aws-cdk-lib/aws-s3/ibucket' },
      { text: 'Type index', link: '/api/modules/aws-cdk-lib/aws-s3' },
    ]);
  });

  test('Others labels type indexes when a section spans several submodules', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'BucketProps', kind: 'Struct' }),
      entry({
        name: 'DeploymentProps',
        kind: 'Struct',
        submodule: 'aws_s3_deployment',
        indexLink: '/api/modules/aws-cdk-lib/aws-s3-deployment',
      }),
    ]));
    const general = sidebar[0].items!.find((g) => g.text === 'General')!;
    const others = general.items!.find((g) => g.text === 'Others')!;
    expect(others.items).toEqual([
      { text: 'Type index (aws_s3)', link: '/api/modules/aws-cdk-lib/aws-s3' },
      { text: 'Type index (aws_s3_deployment)', link: '/api/modules/aws-cdk-lib/aws-s3-deployment' },
    ]);
  });

  test('nested type leaves display only the last FQN segment', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'CfnBucket', kind: 'Construct (L1)', link: '/cfn-bucket' }),
      entry({ name: 'CfnBucket.PolicyProperty', kind: 'Struct', link: '/cfn-bucket-policyproperty' }),
    ]));
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    const others = bucket.items!.find((g) => g.text === 'Others')!;
    // Identity (text) and the link stay the full canonical name — only
    // the display label is shortened.
    expect(others.items).toEqual([
      {
        text: 'CfnBucket.PolicyProperty',
        label: 'PolicyProperty',
        link: '/cfn-bucket-policyproperty',
      },
    ]);
    // Non-nested leaves carry no label field at all (asset unchanged).
    // The construct sits flat inside the resource.
    expect(bucket.items![0]).toEqual({ text: 'CfnBucket', link: '/cfn-bucket' });
  });

  test('omits empty kind groups', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/x' }),
    ]));
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    // Only the flat construct link — no empty kind headings.
    expect(bucket.items).toEqual([{ text: 'Bucket', link: '/x' }]);
  });

  test('rolls interfaces.* submodule types into their owning service', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/api/modules/aws-cdk-lib/aws-s3/bucket' }),
      entry({
        name: 'IBucketRef',
        kind: 'Interface',
        submodule: 'interfaces.aws_s3',
        link: '/api/modules/aws-cdk-lib/interfaces-aws-s3/ibucket-ref',
        indexLink: '/api/modules/aws-cdk-lib/interfaces-aws-s3',
      }),
    ]));
    // No section derived from the structural submodule name.
    expect(sidebar.map((s) => s.text)).toEqual(['S3']);
    // The interface lands under its resource in the owning service,
    // keeping its original page link (canonical identity preserved).
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    const others = bucket.items!.find((g) => g.text === 'Others')!;
    expect(others.items).toContainEqual({
      text: 'IBucketRef',
      link: '/api/modules/aws-cdk-lib/interfaces-aws-s3/ibucket-ref',
    });
  });

  test('rolls a service mixins submodule into the parent service', () => {
    const sidebar = sidebarSections(withSibling([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/api/modules/aws-cdk-lib/aws-s3/bucket' }),
      entry({
        name: 'BucketVersioning',
        kind: 'Mixin',
        submodule: 'aws_s3.mixins',
        link: '/api/modules/aws-cdk-lib/aws-s3-mixins/bucket-versioning',
        indexLink: '/api/modules/aws-cdk-lib/aws-s3-mixins',
      }),
    ]));
    expect(sidebar.map((s) => s.text)).toEqual(['S3']);
    const bucket = sidebar[0].items!.find((g) => g.text === 'Bucket')!;
    const mixins = bucket.items!.find((g) => g.text === 'Mixins')!;
    expect(mixins.items).toContainEqual({
      text: 'BucketVersioning',
      link: '/api/modules/aws-cdk-lib/aws-s3-mixins/bucket-versioning',
    });
  });

  test('the bare interfaces submodule folds into Core', () => {
    const sidebar = sidebarSections([
      entry({
        name: 'IEnvironmentAware',
        kind: 'Interface',
        submodule: 'interfaces',
        link: '/api/modules/aws-cdk-lib/interfaces/ienvironment-aware',
        indexLink: '/api/modules/aws-cdk-lib/interfaces',
      }),
    ]);
    expect(sidebar.map((s) => s.text)).toEqual(['aws-cdk-lib']);
  });

  describe('submodule Overview links', () => {
    test('every section leads with an Overview link to its submodule page', () => {
      const sidebar = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/api/modules/aws-cdk-lib/aws-s3/bucket' }),
        entry({
          name: 'Queue',
          kind: 'Construct (L2)',
          submodule: 'aws_sqs',
          link: '/api/modules/aws-cdk-lib/aws-sqs/queue',
          indexLink: '/api/modules/aws-cdk-lib/aws-sqs',
        }),
      ]);
      expect(sidebar.map((s) => s.text)).toEqual(['S3', 'SQS']);
      expect(sidebar[0].items![0]).toEqual({ text: 'Overview', link: '/api/modules/aws-cdk-lib/aws-s3' });
      expect(sidebar[1].items![0]).toEqual({ text: 'Overview', link: '/api/modules/aws-cdk-lib/aws-sqs' });
    });

    test('a section folding several submodules labels each Overview', () => {
      const sidebar = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
        entry({
          name: 'BucketDeployment',
          kind: 'Construct (L2)',
          submodule: 'aws_s3_deployment',
          link: '/bucket-deployment',
          indexLink: '/api/modules/aws-cdk-lib/aws-s3-deployment',
        }),
      ]);
      expect(sidebar[0].items!.slice(0, 2)).toEqual([
        { text: 'Overview (aws_s3)', link: '/api/modules/aws-cdk-lib/aws-s3' },
        { text: 'Overview (aws_s3_deployment)', link: '/api/modules/aws-cdk-lib/aws-s3-deployment' },
      ]);
    });

    test('structural submodules surface no Overview of their own', () => {
      const sidebar = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
        entry({
          name: 'IBucketRef',
          kind: 'Interface',
          submodule: 'interfaces.aws_s3',
          link: '/api/modules/aws-cdk-lib/interfaces-aws-s3/ibucket-ref',
          indexLink: '/api/modules/aws-cdk-lib/interfaces-aws-s3',
        }),
        entry({
          name: 'BucketVersioning',
          kind: 'Mixin',
          submodule: 'aws_s3.mixins',
          link: '/api/modules/aws-cdk-lib/aws-s3-mixins/bucket-versioning',
          indexLink: '/api/modules/aws-cdk-lib/aws-s3-mixins',
        }),
      ]);
      // One plain Overview for the owning service only — the structural
      // submodules' index pages never become nav entries.
      expect(sidebar[0].items![0]).toEqual({ text: 'Overview', link: '/api/modules/aws-cdk-lib/aws-s3' });
      const links = sidebar[0].items!.filter((i) => !i.items).map((i) => i.link);
      expect(links).not.toContain('/api/modules/aws-cdk-lib/interfaces-aws-s3');
      expect(links).not.toContain('/api/modules/aws-cdk-lib/aws-s3-mixins');
    });

    test('a section with only structural submodules gets no Overview', () => {
      const sidebar = sidebarSections([
        entry({
          name: 'IEnvironmentAware',
          kind: 'Interface',
          submodule: 'interfaces',
          link: '/api/modules/aws-cdk-lib/interfaces/ienvironment-aware',
          indexLink: '/api/modules/aws-cdk-lib/interfaces',
        }),
      ]);
      expect(sidebar[0].text).toBe('aws-cdk-lib');
      expect(sidebar[0].items!.find((i) => i.text.startsWith('Overview'))).toBeUndefined();
    });

    test('multi-submodule Overview labels carry per-language module variants', () => {
      const sidebar = sidebarSections([
        entry({ moduleLabels: { python: 'aws_cdk.aws_s3' } }),
        entry({
          name: 'BucketDeployment',
          kind: 'Construct (L2)',
          submodule: 'aws_s3_deployment',
          link: '/bucket-deployment',
          indexLink: '/api/modules/aws-cdk-lib/aws-s3-deployment',
          moduleLabels: { python: 'aws_cdk.aws_s3_deployment' },
        }),
      ], ['ts', 'python']);
      const overviews = sidebar[0].items!.slice(0, 2);
      expect(overviews[0].text).toBe('Overview (aws_s3)');
      expect(overviews[0].labels).toEqual({ python: 'Overview (aws_cdk.aws_s3)' });
      expect(overviews[1].labels).toEqual({ python: 'Overview (aws_cdk.aws_s3_deployment)' });
    });

    test('a single-submodule Overview stays language-neutral with no labels', () => {
      const sidebar = sidebarSections(
        [entry({ moduleLabels: { python: 'aws_cdk.aws_s3' } })],
        ['ts', 'python'],
      );
      expect(sidebar[0].items![0]).toEqual({ text: 'Overview', link: '/api/modules/aws-cdk-lib/aws-s3' });
    });

    test('qualifies colliding submodule labels with their package', () => {
      const sidebar = sidebarSections([
        entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/bucket' }),
        entry({
          name: 'FancyBucket',
          kind: 'Construct (L3)',
          assemblyName: 'some-standalone-pkg',
          link: '/fancy-bucket',
          indexLink: '/api/modules/some-standalone-pkg/aws-s3',
        }),
      ]);
      expect(sidebar[0].items!.slice(0, 2).map((i) => i.text)).toEqual([
        'Overview',
        'Overview (some-standalone-pkg/aws_s3)',
      ]);
    });
  });
});

/**
 * Construct level tags. The level reaches the tree as its
 * OWN leaf field: the generator never classifies constructs itself, it
 * passes through what the caller supplies from the same determination
 * that badges the type's page.
 */
describe('construct level on sidebar leaves', () => {
  /** Every leaf in the tree, flattened, with its level (or undefined). */
  function leaves(items: SidebarItem[]): { text: string; level?: string }[] {
    return items.flatMap((item) =>
      item.items && item.items.length > 0
        ? leaves(item.items)
        : [{ text: item.text, ...(item.level ? { level: item.level } : {}) }],
    );
  }

  function leafFor(entries: SidebarEntry[], name: string) {
    return leaves(buildServiceSidebar(entries, [])).find((l) => l.text === name);
  }

  const constructs: SidebarEntry[] = [
    entry({ name: 'CfnBucket', kind: 'Construct (L1)', level: 'L1', link: '/api/aws-cdk-lib/aws-s3/CfnBucket' }),
    entry({ name: 'Bucket', kind: 'Construct (L2)', level: 'L2', link: '/api/aws-cdk-lib/aws-s3/Bucket' }),
  ];

  test.each([
    ['CfnBucket', 'L1'],
    ['Bucket', 'L2'],
  ])('%s carries level %s', (name, level) => {
    expect(leafFor(constructs, name)).toEqual({ text: name, level });
  });

  test('L3 constructs carry their level too', () => {
    const entries = [
      entry({
        name: 'ApplicationLoadBalancedFargateService',
        kind: 'Construct (L3)',
        level: 'L3',
        submodule: 'aws_ecs_patterns',
        link: '/api/aws-cdk-lib/aws-ecs-patterns/ApplicationLoadBalancedFargateService',
      }),
    ];
    expect(leafFor(entries, 'ApplicationLoadBalancedFargateService')?.level).toBe('L3');
  });

  test('a construct with no level determination carries no level', () => {
    // `constructs.Construct` itself matches none of the L1/L2/L3
    // heuristics, so the caller supplies no level and the leaf must not
    // invent one.
    const entries = [
      entry({ name: 'Construct', kind: 'Construct', assemblyName: 'constructs', submodule: '', link: '/api/constructs/Construct' }),
    ];
    expect(leafFor(entries, 'Construct')?.level).toBeUndefined();
  });

  test.each([
    ['IBucket', 'Interface'],
    ['BucketProps', 'Struct'],
    ['BucketEncryption', 'Enum'],
    ['BucketGrants', 'Facade'],
    ['IResourceWithPolicyV2', 'Trait'],
    ['BucketMixin', 'Mixin'],
  ])('non-construct %s (%s) carries no level', (name, kind) => {
    const entries = [...constructs, entry({ name, kind, link: `/api/aws-cdk-lib/aws-s3/${name}` })];
    expect(leafFor(entries, name)?.level).toBeUndefined();
  });

  test('the level never leaks into text or label, which are identity', () => {
    // `text` feeds group keys, filter matching and sorting; folding "L2"
    // into it would make `Bucket` match a filter for `l2`.
    const nested = [
      entry({ name: 'CfnBucket.PolicyProperty', kind: 'Struct', link: '/api/aws-cdk-lib/aws-s3/CfnBucket.PolicyProperty' }),
      ...constructs,
    ];
    const all = leaves(buildServiceSidebar(nested, []));
    for (const leaf of all) {
      expect(leaf.text).not.toMatch(/\bL[123]\b/);
    }
    const tree = JSON.stringify(buildServiceSidebar(nested, []));
    expect(tree).not.toMatch(/"label":"L[123]/);
  });
});

/**
 * Construct ordering. The level reaches the tree as a leaf field; this
 * orders by it — L3, L2, L1, then unleveled — instead of by name alone.
 */
describe('construct ordering by level', () => {
  /** Leaf `text`s of the group named `group`, in tree order. */
  function groupOrder(entries: SidebarEntry[], group: string): string[] {
    const find = (items: SidebarItem[]): SidebarItem | undefined => {
      for (const item of items) {
        if (item.text === group) return item;
        const hit = item.items ? find(item.items) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };
    return (find(buildServiceSidebar(entries, []))?.items ?? []).map((i) => i.text);
  }

  function construct(name: string, level: 'L1' | 'L2' | 'L3', overrides: Partial<SidebarEntry> = {}): SidebarEntry {
    return entry({
      name,
      kind: `Construct (${level})`,
      level,
      submodule: 'aws_lambda',
      link: `/api/aws-cdk-lib/aws-lambda/${name}`,
      ...overrides,
    });
  }

  /**
   * A framework module lists its constructs in one flat `Constructs`
   * kind group, so all three tiers sit in a single sorted list there —
   * unlike a service module, which splits them across resource groups.
   */
  function core(name: string, level?: 'L1' | 'L2' | 'L3'): SidebarEntry {
    return entry({
      name,
      kind: level ? `Construct (${level})` : 'Construct',
      ...(level ? { level } : {}),
      submodule: 'core',
      indexLink: '/api/modules/aws-cdk-lib/core',
      link: `/api/aws-cdk-lib/core/${name}`,
    });
  }

  test('level order wins over alphabetical order inside a resource group', () => {
    // `CfnFunction` sorts BEFORE `Function` alphabetically, so this only
    // passes if the level is the primary key. Both share the resource
    // stem `Function`, so they are listed directly in that group — and a
    // sibling resource keeps that group from collapsing, which
    // would otherwise leave the lookup matching the leaf of the same name.
    expect(groupOrder(
      [construct('CfnFunction', 'L1'), construct('Function', 'L2'), construct('Sibling', 'L2')],
      'Function',
    )).toEqual([
      'Function',
      'CfnFunction',
    ]);
  });

  test('all three tiers order L3, L2, L1 with alphabetical order inside each', () => {
    const entries = [
      core('CfnStack', 'L1'),
      core('App', 'L2'),
      core('Stack', 'L2'),
      core('CfnElement', 'L1'),
      core('Zebra', 'L3'),
      core('Aardvark', 'L3'),
    ];
    // Note `Zebra` leads and `App` follows it: alphabetical order alone
    // would invert both pairs.
    expect(groupOrder(entries, 'Constructs')).toEqual([
      'Aardvark',
      'Zebra',
      'App',
      'Stack',
      'CfnElement',
      'CfnStack',
    ]);
  });

  test('constructs with no level determination sort after every leveled one', () => {
    // `constructs.Construct` matches none of the L1/L2/L3 heuristics, so
    // it carries no level and must not jump the leveled tiers on the
    // strength of its name.
    expect(groupOrder([core('Construct'), core('Zzz', 'L1')], 'Constructs')).toEqual(['Zzz', 'Construct']);
  });

  test('non-construct kinds are untouched — still alphabetical', () => {
    const kinds: [string, string][] = [
      ['Mixins', 'Mixin'],
      ['Facades', 'Facade'],
      ['Traits', 'Trait'],
    ];
    for (const [group, kind] of kinds) {
      const entries = [
        entry({ name: 'Zulu', kind, link: '/api/aws-cdk-lib/aws-lambda/Zulu', submodule: 'aws_lambda' }),
        entry({ name: 'Alpha', kind, link: '/api/aws-cdk-lib/aws-lambda/Alpha', submodule: 'aws_lambda' }),
      ];
      expect(groupOrder(entries, group)).toEqual(['Alpha', 'Zulu']);
    }
  });
});

describe('section modules and splitSidebarChunks', () => {
  const entries = [
    entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/v2/docs/aws-cdk-lib.aws_s3.Bucket' }),
    entry({ name: 'IBucketRef', kind: 'Interface', submodule: 'interfaces.aws_s3', link: '/v2/docs/aws-cdk-lib.interfaces.aws_s3.IBucketRef' }),
    entry({ name: 'Topic', kind: 'Construct (L2)', submodule: 'aws_sns', link: '/v2/docs/aws-cdk-lib.aws_sns.Topic' }),
    entry({ name: 'App', kind: 'Class', submodule: '', link: '/v2/docs/aws-cdk-lib.App' }),
    entry({ name: 'Thing', kind: 'Class', assemblyName: '@aws-cdk/aws-amplify-alpha', submodule: '', link: '/v2/docs/@aws-cdk_aws-amplify-alpha.Thing' }),
  ];

  test('every section names the sorted page-id stems of its own entries, structural submodules included', () => {
    const sections = sidebarSections(entries);
    const byText = new Map(sections.map((s) => [s.text, s]));
    expect(byText.get('S3')!.modules).toEqual(['aws-cdk-lib.aws_s3', 'aws-cdk-lib.interfaces.aws_s3']);
    expect(byText.get('SNS')!.modules).toEqual(['aws-cdk-lib.aws_sns']);
    expect(byText.get('aws-cdk-lib')!.modules).toEqual(['aws-cdk-lib']);
    // A standalone package's root types group under an owner derived from its name; the stem is the flattened
    // document id, the same shape the page links carry.
    expect(byText.get('Amplify')!.modules).toEqual(['@aws-cdk_aws-amplify-alpha']);
    // Only section nodes carry it.
    expect(sections.every((s) => (s.items ?? []).every((i) => i.modules === undefined))).toBe(true);
  });

  test('the skeleton keeps every section minus its items and the chunks hold exactly those items', () => {
    const tree = buildServiceSidebar(entries);
    const { skeleton, chunks } = splitSidebarChunks(tree);
    expect(skeleton.map((r) => r.text)).toEqual(tree.map((r) => r.text));
    const skeletonSections = skeleton.flatMap((r) => r.items ?? []);
    const treeSections = tree.flatMap((r) => r.items ?? []);
    expect(skeletonSections.map((s) => s.text)).toEqual(treeSections.map((s) => s.text));
    expect(skeletonSections.every((s) => s.items === undefined && s.chunk !== undefined)).toBe(true);
    expect(chunks.map((c) => c.chunk)).toEqual(skeletonSections.map((s) => s.chunk));
    chunks.forEach((c, i) => expect(c.items).toEqual(treeSections[i].items));
    // Names come from the section text, lower-cased and URL-safe.
    expect(skeletonSections.find((s) => s.text === 'S3')!.chunk).toBe('s3');
    expect(skeletonSections.find((s) => s.text === 'Amplify')!.chunk).toBe('amplify');
  });

  test('colliding chunk names are made unique in tree order', () => {
    const tree: SidebarItem[] = [
      { text: 'Framework', section: true, items: [{ text: 'X Y', items: [{ text: 'a' }] }] },
      { text: 'Services', section: true, items: [{ text: 'x_y', items: [{ text: 'b' }] }, { text: 'x-y', items: [] }] },
    ];
    const { chunks } = splitSidebarChunks(tree);
    expect(chunks.map((c) => c.chunk)).toEqual(['x_y', 'x_y-2', 'x-y']);
    expect(chunks[2].items).toEqual([]);
  });
});
