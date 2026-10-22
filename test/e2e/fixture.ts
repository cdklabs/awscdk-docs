// Pages that exist in the e2e fixture build (scripts/e2e-fixture-prune.cjs
// keeps the aws-sns + aws-sqs services and the constructs module), at the
// historical /v2/docs/ canonical shape.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TOPIC_PAGE = '/v2/docs/aws-cdk-lib.aws_sns.Topic.html';
export const QUEUE_PAGE = '/v2/docs/aws-cdk-lib.aws_sqs.Queue.html';
export const QUEUE_PROPS_PAGE = '/v2/docs/aws-cdk-lib.aws_sqs.QueueProps.html';
export const IQUEUE_PAGE = '/v2/docs/aws-cdk-lib.aws_sqs.IQueue.html';
export const QUEUE_ENCRYPTION_PAGE = '/v2/docs/aws-cdk-lib.aws_sqs.QueueEncryption.html';
export const SQS_OVERVIEW_PAGE = '/v2/docs/aws-cdk-lib.aws_sqs-readme.html';
// An L1. Its header chip is the "Generated code" label rather than a Source
// link, which is the other shape the page title has to stay clean of.
export const CFN_QUEUE_PAGE = '/v2/docs/aws-cdk-lib.aws_sqs.CfnQueue.html';
// A NESTED type: its page name is `CfnTopic.SubscriptionProperty`, one trail
// segment that itself contains a dot. The breadcrumb's copied text only equals
// the FQN because that segment carries its enclosing type.
export const NESTED_TYPE_PAGE = '/v2/docs/aws-cdk-lib.aws_sns.CfnTopic.SubscriptionProperty.html';
/** A Facade class: the fixture surfaces `QueueGrants`. */
export const QUEUE_GRANTS_PAGE = '/v2/docs/aws-cdk-lib.aws_sqs.QueueGrants.html';
export const API_OVERVIEW = '/v2/';
// The hand-written agent-skills page. It is the OTHER page with no resolved
// sidebar besides the home page — themeConfig.sidebar is keyed only on
// /api/ — which is what makes it the second half of the cross-page navbar
// geometry assertion. The fixture prune keeps the hand-written pages, so it
// is served by the e2e build.
export const SKILLS_PAGE = '/skills.html';
// The authored construct-library overview, served here through a VitePress rewrite.
export const CONSTRUCT_LIBRARY_PAGE = '/v2/docs/aws-construct-library.html';
// A class page with descendants, for the subclasses list. The
// pruned fixture keeps the `constructs` module, and `Construct` is the base of
// everything in it — the one page in the fixture with enough subclasses to
// exercise the overflow disclosure.
export const CONSTRUCT_PAGE = '/v2/docs/constructs.Construct.html';
export const IMIXIN_PAGE = '/v2/docs/constructs.IMixin.html';

// A spec cannot spell out a content hash, so both helpers below read the emitted directory. Lazily, so the unit
// suite can import the constants above without a built site.
const API_SIDEBAR_DIR = fileURLToPath(new URL('../../docs/public/api-sidebar', import.meta.url));

/** Served path of a content-hashed api-sidebar asset, by its base name. */
export function apiSidebarAssetPath(base: string): string {
  const pattern = new RegExp(`^${base}\\.[0-9a-f]{8}\\.js$`);
  const file = readdirSync(API_SIDEBAR_DIR).find((name) => pattern.test(name));
  if (!file) {
    throw new Error(`no generated ${base} asset under docs/public/api-sidebar/`);
  }
  return `/api-sidebar/${file}`;
}

/** Chunk base name from a served chunk URL, dropping the content hash so a spec can name the section it expects. */
export function chunkBase(url: string): string {
  return url.replace(/^.*\/api-sidebar\/chunks\//, '').replace(/\.[0-9a-f]{8}\.js$/, '');
}

// Representative pages for the site-wide audit gates. The axe-core gate and
// the Lighthouse gate must audit the SAME set, so the list is exported from
// one place precisely so the two cannot drift apart: adding a page here adds
// it to every gate that imports this list.
//
// The set is the home page plus a sample of API pages, and deliberately
// includes pages carrying the custom interactive components — the navbar
// filter and language toggle render on every page, while a class page also
// mounts the lazy API sidebar, the language tab strips and the type
// tooltips. Those are exactly the JS-driven surfaces a static checker
// cannot see, which is why the audit drives real rendered pages.
export const REPRESENTATIVE_PAGES = [
  '/',
  API_OVERVIEW,
  SQS_OVERVIEW_PAGE,
  TOPIC_PAGE,
  // The hierarchy block's per-row overflow disclosure is one of those custom
  // interactive surfaces, and this is the only audited page carrying one: the
  // relation rows only appear on a type with descendants or implementors,
  // which none of the pages above has.
  CONSTRUCT_PAGE,
] as const;

// Severities that FAIL the accessibility gate. Moderate and minor
// findings are printed for information but do not fail CI: this codebase is
// being gated for the first time, and a gate that fires on cosmetic nits on
// day one gets switched off rather than fixed.
//
// Declared here rather than in the audit spec so the unit suite can pin it
// without importing Playwright — jest deliberately ignores test/e2e/, so a
// constant that lives in a .spec file is unpinnable, and a threshold nobody
// pins is one a later edit can quietly narrow to 'critical' alone.
export const FAILING_IMPACTS = ['critical', 'serious'] as const;
