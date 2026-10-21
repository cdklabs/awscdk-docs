/**
 * Service-oriented sidebar generation.
 *
 * Groups every documented type by AWS service, then by resource (Bucket, Queue, Function, ...), then by kind
 * (Constructs / Mixins / Facades / Traits / Others), regardless of which npm package the type ships in.
 * Core/foundational types (the `constructs` package, the `core` module, and `assets`) get a dedicated flat
 * top-level section.
 */

import { ConstructLevel } from './constructs.js';
import { FRAMEWORK_NAV, FrameworkNav } from './framework-nav.js';
import { Language, translateTypeName } from './languages.js';
import { assemblyDocId } from './links.js';
import { byLevelThenName } from './ordering.js';

export interface SidebarItem {
  readonly text: string;
  /**
   * Canonical display label when it should differ from `text`: nested type names keep their owner-qualified `text`
   * (`CfnBucket.PolicyProperty`) as the node's stable identity — group keys, filter matching and sorting use it —
   * while the sidebar DISPLAYS only the last FQN segment (`PolicyProperty`). Absent when text and display coincide.
   */
  readonly label?: string;
  readonly link?: string;
  readonly collapsed?: boolean;
  /**
   * Per-language display labels: the active language's label replaces the displayed label (`label` when present,
   * else `text`) for DISPLAY only — links, anchors and group keys stay canonical. Only languages whose label
   * differs from the displayed label appear; the field is absent on a single-language build.
   */
  readonly labels?: Readonly<Partial<Record<Language, string>>>;
  /**
   * Marks a fixed structural header: the node renders as a non-collapsible section heading with its children always
   * visible, instead of a fold-out group. Only the top-level Framework / Services nodes carry it.
   */
  readonly section?: boolean;
  /**
   * Marks a KIND group (Constructs / Mixins / Facades / Traits / Others), so the theme can de-emphasize it without
   * guessing from tree depth. A depth-keyed rule breaks once a section with at most one resource drops its resource
   * wrapper: its kind groups sit a level higher, so the same `Others` heading would render two ways depending on how
   * many resources its section has.
   */
  readonly kindGroup?: boolean;
  /**
   * Construct level of a leaf: the tree renders it as a compact L1/L2/L3 tag before the name so a reader tells a
   * `CfnBucket` from a `Bucket` without reading the name. Its OWN field rather than part of `text`/`label`, which are
   * identity: folding "L2" into the label would make `Bucket` match a filter for `l2` and change group keys. Absent
   * on groups and on everything that is not a leveled construct.
   */
  readonly level?: ConstructLevel;
  /** Page-id stems (`<docId>[.<submodule>]`) whose type and overview pages live under this section. Sections only. */
  readonly modules?: readonly string[];
  /** In the served skeleton, the chunk file (`api-sidebar/chunks/<chunk>`) holding this section's `items`. */
  readonly chunk?: string;
  readonly items?: SidebarItem[];
}

/** One documented type, as input to sidebar generation. */
export interface SidebarEntry {
  readonly name: string;
  readonly kind: string;
  /** Site-absolute link to a dedicated page, if one exists. */
  readonly link?: string;
  readonly assemblyName: string;
  /** jsii submodule name ('' = module root). */
  readonly submodule: string;
  /** Link to the type table page of the entry's (sub)module. */
  readonly indexLink: string;
  /**
   * Per-language display names of the entry's owning module, as the reader knows it in each language
   * (`aws-cdk-lib/aws_sqs` in TypeScript, `aws_cdk.aws_sqs` in Python). Computed by the caller, which holds the jsii
   * assembly targets; see {@link sidebarModuleLabels}.
   */
  readonly moduleLabels?: Readonly<Partial<Record<Language, string>>>;
  /**
   * Construct level, supplied by the caller from the same {@link constructLevel} determination that badges the
   * type's page — this module never classifies constructs itself. Absent for interfaces, structs, enums, mixins,
   * facades and traits.
   */
  readonly level?: ConstructLevel;
  /**
   * The owning assembly's jsii stability is `experimental` — the `@aws-cdk/*-alpha` modules. Read from the assembly
   * by the caller, never inferred from the package name. Absent for stable assemblies.
   */
  readonly experimental?: boolean;
}

/**
 * Core grouping key for the symbol index's service label. Not a sidebar heading: the Core group's sidebar heading
 * is the package-qualified `aws-cdk-lib` (see {@link frameworkSectionName}).
 */
export const CORE_SECTION = 'Core';

/**
 * Dedicated Framework section for the `constructs` package: the programming model's base library is surfaced as its
 * own section instead of among the aws-cdk-lib core types. Also the symbol index's service label for those types;
 * the sidebar heading is derived from the assembly name, which is `constructs` anyway.
 */
export const CONSTRUCTS_SECTION = 'constructs';

/** Top-level nav grouping for CDK core / framework modules. */
export const FRAMEWORK_SECTION = 'Framework';

/** Top-level nav grouping for AWS service modules. */
export const SERVICES_SECTION = 'Services';

/** Service-level group for types not tied to a single resource. */
export const GENERAL_GROUP = 'General';

/** Assemblies surfaced as the dedicated `constructs` section. */
const CONSTRUCTS_ASSEMBLIES = new Set(['constructs']);
const CORE_SUBMODULES = new Set(['', 'core', 'assets']);

/**
 * The Lambda-layer asset packages (`lambda_layer_awscli`, `lambda_layer_node_proxy_agent`) are Lambda building
 * blocks, not CDK framework features — they belong under the Lambda service.
 */
const LAMBDA_LAYER_PREFIX = 'lambda_layer_';

/**
 * Irregular service names the token heuristic cannot derive: AWS brand names with internal capitalization
 * ("DynamoDB", "ElastiCache"), multi-word names collapsed into one submodule token ("Amazon MQ",
 * "Global Accelerator"), and mixed-case acronyms ("IoT", "FSx"). Keyed by the first `_`-token after the `aws_`
 * prefix; tokens absent here fall back to the heuristic (<=3 chars uppercased as an acronym, else title-case).
 */
const SERVICE_NAMES: Record<string, string> = {
  accessanalyzer: 'Access Analyzer',
  acmpca: 'ACM PCA',
  aiops: 'AIOps',
  amazonmq: 'Amazon MQ',
  amplifyuibuilder: 'Amplify UI Builder',
  apigateway: 'API Gateway',
  apigatewayv2: 'API Gateway V2',
  appconfig: 'AppConfig',
  appflow: 'AppFlow',
  appintegrations: 'AppIntegrations',
  applicationautoscaling: 'Application Auto Scaling',
  applicationinsights: 'Application Insights',
  applicationsignals: 'Application Signals',
  appmesh: 'App Mesh',
  apprunner: 'App Runner',
  appstream: 'AppStream',
  appsync: 'AppSync',
  apptest: 'AppTest',
  arcregionswitch: 'ARC Region Switch',
  arczonalshift: 'ARC Zonal Shift',
  auditmanager: 'Audit Manager',
  autoscaling: 'Auto Scaling',
  autoscalingplans: 'Auto Scaling Plans',
  b2bi: 'B2BI',
  backupgateway: 'Backup Gateway',
  backupsearch: 'Backup Search',
  bcmdataexports: 'BCM Data Exports',
  bcmpricingcalculator: 'BCM Pricing Calculator',
  bedrockagentcore: 'Bedrock AgentCore',
  billingconductor: 'Billing Conductor',
  certificatemanager: 'Certificate Manager',
  cleanrooms: 'Clean Rooms',
  cleanroomsml: 'Clean Rooms ML',
  cloudformation: 'CloudFormation',
  cloudfront: 'CloudFront',
  cloudtrail: 'CloudTrail',
  cloudwatch: 'CloudWatch',
  codeartifact: 'CodeArtifact',
  codebuild: 'CodeBuild',
  codecommit: 'CodeCommit',
  codeconnections: 'CodeConnections',
  codedeploy: 'CodeDeploy',
  codeguruprofiler: 'CodeGuru Profiler',
  codegurureviewer: 'CodeGuru Reviewer',
  codepipeline: 'CodePipeline',
  codestar: 'CodeStar',
  codestarconnections: 'CodeStar Connections',
  codestarnotifications: 'CodeStar Notifications',
  cognitosync: 'Cognito Sync',
  computeoptimizer: 'Compute Optimizer',
  connectcampaigns: 'Connect Campaigns',
  connectcampaignsv2: 'Connect Campaigns V2',
  controlcatalog: 'Control Catalog',
  controltower: 'Control Tower',
  customerprofiles: 'Customer Profiles',
  databrew: 'DataBrew',
  datapipeline: 'Data Pipeline',
  datasync: 'DataSync',
  datazone: 'DataZone',
  devicefarm: 'Device Farm',
  devopsguru: 'DevOps Guru',
  directconnect: 'Direct Connect',
  directoryservice: 'Directory Service',
  docdb: 'DocDB',
  docdbelastic: 'DocDB Elastic',
  dsql: 'DSQL',
  dynamodb: 'DynamoDB',
  elasticache: 'ElastiCache',
  elasticbeanstalk: 'Elastic Beanstalk',
  elasticloadbalancing: 'Elastic Load Balancing',
  elasticloadbalancingv2: 'Elastic Load Balancing V2',
  emrcontainers: 'EMR Containers',
  emrserverless: 'EMR Serverless',
  entityresolution: 'Entity Resolution',
  eventschemas: 'EventSchemas',
  finspace: 'FinSpace',
  frauddetector: 'Fraud Detector',
  fsx: 'FSx',
  gamelift: 'GameLift',
  gameliftstreams: 'GameLift Streams',
  globalaccelerator: 'Global Accelerator',
  greengrassv2: 'Greengrass V2',
  groundstation: 'Ground Station',
  guardduty: 'GuardDuty',
  healthimaging: 'HealthImaging',
  healthlake: 'HealthLake',
  identitystore: 'Identity Store',
  imagebuilder: 'Image Builder',
  inspectorv2: 'Inspector V2',
  internetmonitor: 'Internet Monitor',
  iot: 'IoT',
  iotanalytics: 'IoT Analytics',
  iotcoredeviceadvisor: 'IoT Core Device Advisor',
  iotevents: 'IoT Events',
  iotfleethub: 'IoT FleetHub',
  iotfleetwise: 'IoT FleetWise',
  iotsitewise: 'IoT SiteWise',
  iotthingsgraph: 'IoT Things Graph',
  iottwinmaker: 'IoT TwinMaker',
  iotwireless: 'IoT Wireless',
  ivschat: 'IVS Chat',
  kafkaconnect: 'Kafka Connect',
  kendraranking: 'Kendra Ranking',
  kinesisanalytics: 'Kinesis Analytics',
  kinesisanalyticsv2: 'Kinesis Analytics V2',
  kinesisfirehose: 'Kinesis Firehose',
  kinesisvideo: 'Kinesis Video',
  lakeformation: 'Lake Formation',
  launchwizard: 'Launch Wizard',
  lex: 'Lex',
  licensemanager: 'License Manager',
  lookoutequipment: 'Lookout for Equipment',
  lookoutmetrics: 'Lookout for Metrics',
  lookoutvision: 'Lookout for Vision',
  managedblockchain: 'Managed Blockchain',
  mediaconnect: 'MediaConnect',
  mediaconvert: 'MediaConvert',
  medialive: 'MediaLive',
  mediapackage: 'MediaPackage',
  mediapackagev2: 'MediaPackage V2',
  mediastore: 'MediaStore',
  mediatailor: 'MediaTailor',
  memorydb: 'MemoryDB',
  mwaa: 'MWAA',
  mwaaserverless: 'MWAA Serverless',
  neptunegraph: 'Neptune Graph',
  networkfirewall: 'Network Firewall',
  networkflowmonitor: 'Network Flow Monitor',
  networkmanager: 'Network Manager',
  nimblestudio: 'Nimble Studio',
  notificationscontacts: 'Notifications Contacts',
  novaact: 'Nova Act',
  observabilityadmin: 'Observability Admin',
  opensearchserverless: 'OpenSearch Serverless',
  opensearchservice: 'OpenSearch Service',
  opsworks: 'OpsWorks',
  opsworkscm: 'OpsWorks CM',
  osis: 'OSIS',
  paymentcryptography: 'Payment Cryptography',
  pcaconnectorad: 'PCA Connector AD',
  pcaconnectorscep: 'PCA Connector SCEP',
  pinpointemail: 'Pinpoint Email',
  qbusiness: 'Q Business',
  qldb: 'QLDB',
  quicksight: 'QuickSight',
  rbin: 'Recycle Bin',
  redshiftserverless: 'Redshift Serverless',
  refactorspaces: 'Refactor Spaces',
  resiliencehub: 'Resilience Hub',
  resiliencehubv2: 'Resilience Hub V2',
  resourceexplorer2: 'Resource Explorer 2',
  resourcegroups: 'Resource Groups',
  robomaker: 'RoboMaker',
  rolesanywhere: 'Roles Anywhere',
  route53: 'Route 53',
  route53globalresolver: 'Route 53 Global Resolver',
  route53profiles: 'Route 53 Profiles',
  route53recoverycontrol: 'Route 53 Recovery Control',
  route53recoveryreadiness: 'Route 53 Recovery Readiness',
  route53resolver: 'Route 53 Resolver',
  rtbfabric: 'RTB Fabric',
  s3express: 'S3 Express',
  s3objectlambda: 'S3 Object Lambda',
  s3outposts: 'S3 Outposts',
  s3tables: 'S3 Tables',
  s3vectors: 'S3 Vectors',
  sagemaker: 'SageMaker',
  secretsmanager: 'Secrets Manager',
  securityhub: 'Security Hub',
  securitylake: 'Security Lake',
  servicecatalog: 'Service Catalog',
  servicecatalogappregistry: 'Service Catalog AppRegistry',
  servicediscovery: 'Service Discovery',
  simspaceweaver: 'SimSpace Weaver',
  smsvoice: 'SMS Voice',
  ssmcontacts: 'SSM Contacts',
  ssmguiconnect: 'SSM GUI Connect',
  ssmincidents: 'SSM Incidents',
  ssmquicksetup: 'SSM Quick Setup',
  stepfunctions: 'Step Functions',
  storagegateway: 'Storage Gateway',
  supportapp: 'Support App',
  systemsmanagersap: 'Systems Manager SAP',
  usernotifications: 'User Notifications',
  verifiedpermissions: 'Verified Permissions',
  voiceid: 'Voice ID',
  vpclattice: 'VPC Lattice',
  wafregional: 'WAF Regional',
  wafv2: 'WAF V2',
  wellarchitected: 'Well-Architected',
  workspaces: 'WorkSpaces',
  workspacesinstances: 'WorkSpaces Instances',
  workspacesthinclient: 'WorkSpaces Thin Client',
  workspacesweb: 'WorkSpaces Web',
  xray: 'X-Ray',
};

/** True for types surfaced in the dedicated `constructs` section. */
export function isConstructsPackage(assemblyName: string): boolean {
  return CONSTRUCTS_ASSEMBLIES.has(assemblyName);
}

/** Foundational aws-cdk-lib types live in the dedicated Core section. */
export function isCore(assemblyName: string, submodule: string): boolean {
  return assemblyName === 'aws-cdk-lib' && CORE_SUBMODULES.has(submodule);
}

/**
 * Whether a (service-owner) submodule documents an AWS service rather than a CDK framework feature. Services follow
 * the assembly's naming convention — `aws_*` submodules, plus the vendored `alexa_*` service bindings — so a new
 * service lands in the Services grouping automatically. Everything else (`assertions`, `custom_resources`,
 * `pipelines`, `cx_api`, `region_info`, ... and the Core section itself) is framework, the safe default since new
 * service submodules always carry the prefix while framework modules are free-form.
 */
export function isServiceSubmodule(submodule: string): boolean {
  return (
    submodule.startsWith('aws_')
    || submodule.startsWith('alexa_')
    // Lambda-layer asset packages belong to the Lambda service.
    || submodule.startsWith(LAMBDA_LAYER_PREFIX)
  );
}

/**
 * Structural submodule name segments. `interfaces.*` mirrors the parent package tree and `<service>.mixins` holds a
 * service's mixin types; neither is an AWS service or CDK feature, so neither may surface as its own navigation
 * branch. The jsii assembly does not flag these groupings — they are regular submodules — so detection is by their
 * reserved names.
 */
const STRUCTURAL_PREFIX = 'interfaces';
const STRUCTURAL_SUFFIX = '.mixins';

/**
 * The service/feature submodule that owns a (possibly structural) submodule's types. Strips the structural
 * `interfaces.` mirror prefix and the per-service `.mixins` suffix so `interfaces.aws_s3` and `aws_s3.mixins` both
 * resolve to `aws_s3`, and the bare `interfaces` submodule resolves to the module root (Core). Non-structural
 * submodules pass through unchanged. Grouping only; page URLs and cross-reference links are untouched.
 */
export function serviceSubmodule(submodule: string): string {
  let owner = submodule;
  if (owner === STRUCTURAL_PREFIX) {
    owner = '';
  } else if (owner.startsWith(`${STRUCTURAL_PREFIX}.`)) {
    owner = owner.slice(STRUCTURAL_PREFIX.length + 1);
  }
  if (owner.endsWith(STRUCTURAL_SUFFIX)) {
    owner = owner.slice(0, -STRUCTURAL_SUFFIX.length);
  }
  return owner;
}

/**
 * Grouping owner for a standalone (non-`aws-cdk-lib`) assembly whose types live at the assembly root, i.e. carry no
 * submodule. Derived from the package name — scope and `-alpha` suffix stripped, dashes to underscores — so it flows
 * through the SAME service/feature partition as aws-cdk-lib submodules: `@aws-cdk/aws-lambda-python-alpha` becomes
 * `aws_lambda_python` and folds into the Lambda Services section next to `aws_lambda`, while non-service packages
 * (`@aws-cdk/integ-tests-alpha`) become their own Framework section. `aws-cdk-lib` itself maps to the empty owner so
 * its root types keep landing in Core (CORE_SUBMODULES).
 */
export function assemblyOwner(assemblyName: string): string {
  if (assemblyName === 'aws-cdk-lib') {
    return '';
  }
  return assemblyName
    .replace(/^@aws-cdk\//, '')
    .replace(/-alpha$/, '')
    .replace(/-/g, '_');
}

/**
 * Framework section heading for an entry: the package-qualified module name, taken verbatim from the jsii assembly.
 *
 * Framework modules are not AWS services — readers identify them by the package (and submodule) they import — so the
 * heading is `assembly.name` for a package root and `${assembly.name}.${submodule}` for a submodule:
 * `aws-cdk-lib.assertions`, `@aws-cdk/app-staging-synthesizer-alpha`, `constructs`. NOT derived through
 * {@link assemblyOwner} or {@link sectionName}, whose scope/`-alpha` stripping and title-casing cannot reproduce the
 * package name.
 *
 * `submodule` is the OWNER submodule ({@link serviceSubmodule} applied to the entry's own name), so the structural
 * `interfaces.*` mirror and `*.mixins` suffix collapse into their owner's heading. The Core section folds the `''`,
 * `core` and `assets` submodules into a single group whose label is the bare package name — `aws-cdk-lib`, never
 * `aws-cdk-lib.core`. `constructs` needs no special case: its assembly name is already `constructs` and its types
 * carry no submodule.
 */
export function frameworkSectionName(assemblyName: string, submodule: string): string {
  if (submodule === '' || isCore(assemblyName, submodule)) {
    return assemblyName;
  }
  return `${assemblyName}.${submodule}`;
}

/**
 * Collation for Framework section headings. Package-qualified names sort alphabetically with `@`-scoped packages
 * LAST — the opposite of default string ordering, where `@` (U+0040) precedes `A` (U+0041) — so the scoped/unscoped
 * split is the primary key and the collator only breaks ties. `sensitivity: 'base'` keeps the order
 * case-insensitive, and `numeric: true` matches the rest of the tree's handling of digit-suffixed names.
 */
const FRAMEWORK_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function frameworkSectionCompare(a: string, b: string): number {
  const scoped = (s: string) => (s.startsWith('@') ? 1 : 0);
  return scoped(a) - scoped(b) || FRAMEWORK_COLLATOR.compare(a, b);
}

/**
 * Section name for a jsii submodule.
 *
 * `aws_`-prefixed submodules map to their AWS service: the first token
 * after the prefix is the service key, so integration submodules fold
 * into their service (`aws_s3_deployment` -> S3, like `aws_s3`).
 * Non-service submodules (e.g. `custom_resources`) keep their full
 * name, title-cased.
 */
export function sectionName(submodule: string): string {
  // The Lambda-layer packages fold into the Lambda service, exactly like `aws_lambda` and its integration submodules.
  if (submodule.startsWith(LAMBDA_LAYER_PREFIX)) {
    return displayToken('lambda');
  }
  const tokens = submodule.startsWith('aws_')
    ? [submodule.slice(4).split('_')[0]]
    : submodule.split('_');
  return tokens.map(displayToken).join(' ');
}

function displayToken(token: string): string {
  if (SERVICE_NAMES[token]) {
    return SERVICE_NAMES[token];
  }
  // Short tokens are acronyms (s3, iam, ec2, sqs, api, ...).
  if (token.length <= 3) {
    return token.toUpperCase();
  }
  return token[0].toUpperCase() + token.slice(1);
}

/**
 * Build the VitePress sidebar: two top-level sections — Framework (CDK core and framework feature modules) then
 * Services (the `aws_*` service modules) — so core primitives are found without scrolling past hundreds of services.
 * Both are fixed, non-collapsible structural headers (`section: true`). The Core group leads Framework and the
 * `constructs` base library is a group of its own; Framework headings are the package-qualified module names sorted
 * by {@link frameworkSectionCompare}, while Services stay alphabetical.
 *
 * Every section starts with direct `Overview` link(s) to its (sub)module page(s), then Core and `constructs` keep a
 * flat kind grouping; every other section groups by resource (derived from construct names). Inside a resource,
 * construct types are listed directly (no "Constructs" heading) and the remaining kind groups start collapsed.
 * Sections and resource groups are collapsible. This is a nav-grouping change only: page URLs and cross-reference
 * links are untouched.
 *
 * With two or more enabled `languages`, leaf items whose display name is language-variant carry a `labels` field
 * with one entry per differing language; group headings (service, resource, kind) are language-neutral. With a
 * single language there is no `labels` field anywhere.
 */
export function buildServiceSidebar(
  entries: SidebarEntry[],
  languages: readonly Language[] = [],
): SidebarItem[] {
  const framework = new Map<string, SidebarEntry[]>();
  const services = new Map<string, SidebarEntry[]>();
  // Framework headings that keep Core's flat kind grouping instead of resource groups. Tracked as a set of keys
  // rather than matched against the heading text, because the heading is a package-qualified name, not a constant.
  const flatSections = new Set<string>();
  for (const entry of entries) {
    // Structural submodules (`interfaces.*`, `*.mixins`) roll into the service that owns their types; root types of
    // a standalone package group by an owner derived from the package name.
    const submodule = serviceSubmodule(entry.submodule);
    const owner = submodule || assemblyOwner(entry.assemblyName);
    // The `constructs` base library is its own Framework section; aws-cdk-lib core/assets stay in Core.
    const constructsPkg = isConstructsPackage(entry.assemblyName);
    const core = !constructsPkg && isCore(entry.assemblyName, owner);
    // Framework vs Services partition: Core, `constructs`, and the non-`aws_*` feature modules are framework; the
    // rest are services.
    const service = !constructsPkg && !core && isServiceSubmodule(owner);
    // Service headings stay the AWS service name; Framework headings are the package-qualified module name.
    const section = service
      ? sectionName(owner)
      : frameworkSectionName(entry.assemblyName, submodule);
    const sections = service ? services : framework;
    if (constructsPkg || core) {
      flatSections.add(section);
    }
    const list = sections.get(section) ?? [];
    list.push(entry);
    sections.set(section, list);
  }

  const sectionItems = (
    sections: Map<string, SidebarEntry[]>,
    compare: (a: string, b: string) => number,
    flat: ReadonlySet<string>,
  ): SidebarItem[] => {
    const names = [...sections.keys()].sort(compare);
    return names.map((name) => ({
      text: name,
      collapsed: true,
      modules: sectionModules(sections.get(name)!),
      items: [
        ...overviewItems(sections.get(name)!, languages),
        ...(flat.has(name)
          ? kindGroups(sections.get(name)!, languages)
          : resourceGroups(sections.get(name)!, languages)),
      ],
    }));
  };

  const servicesCompare = (a: string, b: string): number => a.localeCompare(b);
  const noFlatSections: ReadonlySet<string> = new Set<string>();

  // Framework and Services are fixed, non-collapsible section headers — structural landmarks, not fold-out nodes.
  // `collapsed: false` is kept so older clients of the asset still treat them as pre-opened.
  const top: SidebarItem[] = [];
  if (framework.size > 0) {
    top.push({
      text: FRAMEWORK_SECTION,
      section: true,
      collapsed: false,
      items: curateFramework(sectionItems(framework, frameworkSectionCompare, flatSections), framework),
    });
  }
  if (services.size > 0) {
    top.push({
      text: SERVICES_SECTION,
      section: true,
      collapsed: false,
      items: sectionItems(services, servicesCompare, noFlatSections),
    });
  }
  return top;
}

/**
 * Apply the editorial {@link FRAMEWORK_NAV} list to the Framework sections: listed sections form the top level in
 * list order (a friendly `label` changes the display only; `text` stays the module name), and every other section
 * nests under its package root when that root is listed, else under `defaultParent`. A nested section keeps its own
 * Overview link and types, follows its parent's own groups, and its page stems join the parent's `modules`, so the
 * served skeleton still maps every page to the chunk that holds it. A listed section the build does not document is
 * skipped; with no listed parent available, unlisted sections stay on the top level so nothing leaves the nav.
 */
function curateFramework(
  sections: readonly SidebarItem[],
  entries: ReadonlyMap<string, readonly SidebarEntry[]>,
  nav: FrameworkNav = FRAMEWORK_NAV,
): SidebarItem[] {
  const byName = new Map(sections.map((s) => [s.text, s]));
  const listed = nav.topLevel.filter((e) => byName.has(e.section));
  const listedNames = new Set(listed.map((e) => e.section));
  const children = new Map<string, SidebarItem[]>();
  const orphans: SidebarItem[] = [];
  for (const section of sections) {
    if (listedNames.has(section.text)) {
      continue;
    }
    const root = entries.get(section.text)?.[0]?.assemblyName;
    const parent = root !== undefined && listedNames.has(root)
      ? root
      : listedNames.has(nav.defaultParent)
        ? nav.defaultParent
        : undefined;
    if (parent === undefined) {
      orphans.push(section);
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(section);
    children.set(parent, list);
  }
  const top = listed.map((e): SidebarItem => {
    const section = byName.get(e.section)!;
    const nested = (children.get(e.section) ?? []).sort((a, b) => frameworkSectionCompare(a.text, b.text));
    const modules = [...new Set([...(section.modules ?? []), ...nested.flatMap((c) => c.modules ?? [])])].sort(
      (a, b) => a.localeCompare(b),
    );
    return {
      ...section,
      ...(e.label !== undefined ? { label: e.label } : {}),
      modules,
      items: [...(section.items ?? []), ...nested],
    };
  });
  return [...top, ...orphans];
}

/** Sorted, distinct page-id stems (`<docId>[.<submodule>]`) of a section's entries. */
function sectionModules(entries: readonly SidebarEntry[]): string[] {
  const stems = new Set<string>();
  for (const e of entries) {
    stems.add(assemblyDocId(e.assemblyName) + (e.submodule ? `.${e.submodule}` : ''));
  }
  return [...stems].sort((a, b) => a.localeCompare(b));
}

/** A section's items, served as one file per section. */
export interface SidebarChunk {
  readonly chunk: string;
  readonly items: SidebarItem[];
}

/**
 * Split the full tree into the served skeleton (every section node minus its `items`, naming its chunk) and one
 * chunk per section. Chunk names derive from the section text, URL-safe and unique in tree order.
 */
export function splitSidebarChunks(tree: readonly SidebarItem[]): { skeleton: SidebarItem[]; chunks: SidebarChunk[] } {
  const chunks: SidebarChunk[] = [];
  const used = new Set<string>();
  const skeleton = tree.map((root) => ({
    ...root,
    items: (root.items ?? []).map((section) => {
      const { items, ...rest } = section;
      const chunk = uniqueChunkName(section.text, used);
      chunks.push({ chunk, items: items ?? [] });
      return { ...rest, chunk };
    }),
  }));
  return { skeleton, chunks };
}

/** Rewrite each section's `chunk` to the filename its chunk was written under, so the skeleton names hashed files. */
export function renameChunks(
  skeleton: readonly SidebarItem[],
  rename: (chunk: string) => string,
): SidebarItem[] {
  return skeleton.map((root) => ({
    ...root,
    items: (root.items ?? []).map((section) =>
      section.chunk ? { ...section, chunk: rename(section.chunk) } : section,
    ),
  }));
}

function uniqueChunkName(text: string, used: Set<string>): string {
  const base = text.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
  let name = base;
  for (let n = 2; used.has(name); n++) {
    name = `${base}-${n}`;
  }
  used.add(name);
  return name;
}

/**
 * Overview links for a section: one leaf per distinct (sub)module page among the section's entries, rendered before
 * the resource/kind groups so a submodule's Overview page (e.g. `aws_s3` -> `/v2/docs/aws-cdk-lib.aws_s3-readme`)
 * is one click from the sidebar. The link is each entry's existing `indexLink` — the canonical module page path
 * computed by the docgen — so it stays base-aware via the component's `withBase`. A section holding a single
 * (sub)module gets a plain `Overview` entry; a section folding several (e.g. S3 with `aws_s3` + `aws_s3_deployment`)
 * disambiguates each, mirroring the `Type index (...)` convention. Structural submodules (`interfaces.*`, `*.mixins`)
 * never surface an overview of their own — they are internal assembly layout, not navigation.
 */
function overviewItems(entries: SidebarEntry[], languages: readonly Language[]): SidebarItem[] {
  const byLink = new Map<string, SidebarEntry>();
  for (const e of entries) {
    if (serviceSubmodule(e.submodule) !== e.submodule) {
      continue;
    }
    if (!byLink.has(e.indexLink)) {
      byLink.set(e.indexLink, e);
    }
  }
  const chosen = [...byLink.entries()].sort(([aLink, a], [bLink, b]) => {
    const canonical = (e: SidebarEntry) => (e.assemblyName === 'aws-cdk-lib' ? 0 : 1);
    return canonical(a) - canonical(b) || aLink.localeCompare(bLink);
  });
  const multiple = chosen.length > 1;
  const shortLabel = (e: SidebarEntry) => e.submodule || e.assemblyName;
  // Two packages can contribute the SAME submodule to one section
  // (`aws_s3` from aws-cdk-lib and a standalone package); qualify
  // colliding labels with their package so each Overview stays
  // unambiguous.
  const counts = new Map<string, number>();
  for (const [, e] of chosen) {
    const label = shortLabel(e);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return chosen.map(([link, e]) => {
    const short = shortLabel(e);
    const label = counts.get(short)! > 1 ? `${e.assemblyName}/${short}` : short;
    const canonicalCollision = e.assemblyName === 'aws-cdk-lib' && counts.get(short)! > 1;
    const text = !multiple || canonicalCollision ? 'Overview' : `Overview (${label})`;
    // Module labels genuinely differ per language; canonical collision and single-module text stays language-neutral.
    const labels = labelVariants(text, languages, (lang) => {
      const moduleLabel = e.moduleLabels?.[lang];
      return moduleLabel === undefined
        ? undefined
        : !multiple || canonicalCollision ? 'Overview' : `Overview (${moduleLabel})`;
    });
    return { text, ...(labels ? { labels } : {}), link };
  });
}

/**
 * Derive the resource stem of a type name: strip the `Cfn` L1 prefix,
 * the `I` interface prefix, and the `Props` suffix, so `CfnBucket`,
 * `IBucket`, and `BucketProps` all stem to `Bucket`. Nested type
 * names (`CfnBucket.PolicyProperty`) stem from their owner type.
 */
export function resourceStem(name: string): string {
  let stem = name.split('.')[0];
  if (stem.length > 3 && stem.startsWith('Cfn') && isUpper(stem[3])) {
    stem = stem.slice(3);
  }
  if (stem.length > 1 && stem[0] === 'I' && isUpper(stem[1])) {
    stem = stem.slice(1);
  }
  if (stem.length > 5 && stem.endsWith('Props')) {
    stem = stem.slice(0, -5);
  }
  return stem;
}

function isUpper(char: string): boolean {
  return char >= 'A' && char <= 'Z';
}

function isConstructKind(entry: SidebarEntry): boolean {
  return entry.kind.startsWith('Construct');
}

/**
 * Group a section's entries by resource: every construct defines a resource named by its stem (pairing L1
 * `CfnBucket` with L2 `Bucket`), and related types attach to the resource their stem names — exactly, or as the
 * longest resource that prefixes the stem at an uppercase boundary (`BucketPolicyProps` → BucketPolicy, not Bucket).
 * Types matching no resource (and types without dedicated pages) land in a service-level General group. Resource
 * groups are collapsed; kind headings inside them are pre-opened.
 */
function resourceGroups(entries: SidebarEntry[], languages: readonly Language[]): SidebarItem[] {
  const resources = new Set(
    entries.filter(isConstructKind).map((e) => resourceStem(e.name)),
  );

  const byResource = new Map<string, SidebarEntry[]>();
  const general: SidebarEntry[] = [];
  for (const entry of entries) {
    const resource = isConstructKind(entry)
      ? resourceStem(entry.name)
      : entry.link
        ? resourceFor(entry.name, resources)
        : undefined;
    if (resource === undefined) {
      general.push(entry);
      continue;
    }
    const list = byResource.get(resource) ?? [];
    list.push(entry);
    byResource.set(resource, list);
  }

  // A single resource wrapper carries no information: every symbol in the section already belongs to that resource,
  // so the heading restates the section name and buries its construct behind a click. Zero named resources is the
  // same condition (a section whose only group is `General`), so both collapse here.
  if (byResource.size <= 1) {
    return resourceItems(entries, languages);
  }

  const groups: SidebarItem[] = [...byResource.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((resource) => ({
      text: resource,
      collapsed: true,
      items: resourceItems(byResource.get(resource)!, languages),
    }));
  if (general.length > 0) {
    groups.push({ text: GENERAL_GROUP, collapsed: true, items: kindGroups(general, languages) });
  }
  return groups;
}

/**
 * Items inside one resource group: the construct types are the resource's primary content, so they are listed
 * DIRECTLY — no intermediate "Constructs" heading — followed by the remaining kind groups (Mixins / Facades /
 * Traits / Others), which start collapsed so expanding a resource surfaces its constructs and hides the long tail
 * of supporting types.
 */
function resourceItems(entries: SidebarEntry[], languages: readonly Language[]): SidebarItem[] {
  const constructs = entries.filter(isConstructKind);
  const rest = entries.filter((e) => !isConstructKind(e));
  return [...linkedItems(constructs, languages), ...kindGroups(rest, languages)];
}

/**
 * Resource a type belongs to: its stem exactly, or the longest
 * resource that prefixes the stem at an uppercase boundary
 * (`BucketEncryption` → Bucket). No match means no clear owner.
 */
function resourceFor(name: string, resources: Set<string>): string | undefined {
  const stem = resourceStem(name);
  if (resources.has(stem)) {
    return stem;
  }
  let best: string | undefined;
  for (const resource of resources) {
    if (
      stem.length > resource.length
      && stem.startsWith(resource)
      && isUpper(stem[resource.length])
      && (best === undefined || resource.length > best.length)
    ) {
      best = resource;
    }
  }
  return best;
}

/**
 * Partition entries into Constructs / Mixins / Facades / Traits / Others, in the design guidelines' building-block
 * order: facades are the resource-specific integration classes (`BucketGrants`), traits the service-agnostic
 * capability contracts (`IResourceWithPolicyV2` and its factory). Groups with no members are omitted. All kind
 * headings start collapsed: inside a resource the constructs are already listed directly (see {@link resourceItems}),
 * so the kind groups only hold the supporting types, hidden by default.
 */
function kindGroups(
  entries: SidebarEntry[],
  languages: readonly Language[],
): SidebarItem[] {
  const collapsed = true;
  const constructs = entries.filter((e) => e.kind.startsWith('Construct'));
  const mixins = entries.filter((e) => e.kind === 'Mixin');
  const facades = entries.filter((e) => e.kind === 'Facade');
  const traits = entries.filter((e) => e.kind === 'Trait');
  const others = entries.filter(
    (e) => !e.kind.startsWith('Construct') && e.kind !== 'Mixin' && e.kind !== 'Facade' && e.kind !== 'Trait',
  );

  const groups: SidebarItem[] = [];
  if (constructs.length > 0) {
    groups.push({ text: 'Constructs', collapsed, kindGroup: true, items: linkedItems(constructs, languages) });
  }
  if (mixins.length > 0) {
    groups.push({ text: 'Mixins', collapsed, kindGroup: true, items: linkedItems(mixins, languages) });
  }
  if (facades.length > 0) {
    groups.push({ text: 'Facades', collapsed, kindGroup: true, items: linkedItems(facades, languages) });
  }
  if (traits.length > 0) {
    groups.push({ text: 'Traits', collapsed, kindGroup: true, items: linkedItems(traits, languages) });
  }
  if (others.length > 0) {
    groups.push({ text: 'Others', collapsed, kindGroup: true, items: otherItems(others, languages) });
  }
  return groups;
}

/**
 * Per-language display labels for one item: only languages whose rendered label exists and differs from the
 * canonical text are kept, and fewer than two enabled languages yields no labels.
 */
function labelVariants(
  canonical: string,
  languages: readonly Language[],
  render: (lang: Language) => string | undefined,
): Partial<Record<Language, string>> | undefined {
  if (languages.length < 2) {
    return undefined;
  }
  let out: Partial<Record<Language, string>> | undefined;
  for (const lang of languages) {
    const label = render(lang);
    if (label !== undefined && label !== canonical) {
      (out ??= {})[lang] = label;
    }
  }
  return out;
}

/**
 * The displayed part of a type name: the last FQN segment. Nested type names (`CfnBucket.PolicyProperty`) render as
 * their bare name (`PolicyProperty`) — the owning type is already visible as the enclosing resource group, so the
 * prefix is redundant in the nav.
 */
export function shortTypeName(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? name : name.slice(idx + 1);
}

function linkedItems(entries: SidebarEntry[], languages: readonly Language[]): SidebarItem[] {
  return [...entries]
    // Constructs read L3 -> L2 -> L1 -> unleveled; non-construct lists are all one rank, so they stay alphabetical.
    .sort(byLevelThenName)
    .map((e) => {
      // Identity stays the full canonical name (group keys, filter matching); only the DISPLAY label is shortened.
      const short = shortTypeName(e.name);
      // jsii preserves type names across all targets, so this yields no labels today — wired through so the sidebar
      // follows the on-page transliteration if that changes.
      const labels = labelVariants(short, languages, (lang) => translateTypeName(short, lang));
      return {
        text: e.name,
        ...(short !== e.name ? { label: short } : {}),
        link: e.link,
        ...(labels ? { labels } : {}),
        ...(e.level ? { level: e.level } : {}),
      };
    });
}

/**
 * Others (classes/interfaces/enums) mostly have no dedicated pages yet: link individual pages when present, and
 * fall back to the (sub)module type table for the rest. Once dedicated pages exist, they surface here automatically
 * via `link`.
 */
function otherItems(entries: SidebarEntry[], languages: readonly Language[]): SidebarItem[] {
  const linked = entries.filter((e) => e.link);
  const unlinked = entries.filter((e) => !e.link);

  const items = linkedItems(linked, languages);
  const indexEntries = new Map<string, SidebarEntry>();
  for (const e of unlinked) {
    indexEntries.set(e.indexLink, e);
  }
  const multiple = indexEntries.size > 1;
  for (const [link, e] of [...indexEntries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const label = e.submodule || e.assemblyName;
    const text = multiple ? `Type index (${label})` : 'Type index';
    // Module/package labels genuinely differ per language (`aws-cdk-lib/aws_sqs` vs `aws_cdk.aws_sqs`); the caller
    // supplies them from the jsii assembly targets.
    const labels = labelVariants(text, languages, (lang) => {
      const moduleLabel = e.moduleLabels?.[lang];
      return moduleLabel === undefined
        ? undefined
        : multiple ? `Type index (${moduleLabel})` : 'Type index';
    });
    items.push({ text, ...(labels ? { labels } : {}), link });
  }
  return items;
}
