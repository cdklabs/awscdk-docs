import { jest } from '@jest/globals';
import { el, FakeElement, installFakeDocument } from './fake-dom.js';

jest.unstable_mockModule('vitepress', () => ({ withBase: (path: string) => `/cdk/api${path}` }));

const ASSET = 'type-summaries.0123abcd.js';
const QUEUE = '/v2/docs/aws-cdk-lib.aws_sqs.Queue';
const SUMMARIES = {
  [QUEUE]: { name: 'Queue', kind: 'class', summary: 'A new Amazon SQS queue.', label: 'L2 construct', level: 'L2' },
  '/v2/docs/aws-cdk-lib.aws_sqs.QueueProps': { name: 'QueueProps', kind: 'struct', summary: '' },
  '/v2/docs/aws-cdk-lib.aws_sqs.QueueEncryption': { name: 'QueueEncryption', kind: 'Enum', summary: 'Encryption.' },
  '/v2/docs/aws-cdk-lib.Duration': { name: 'Duration', kind: 'class', summary: 'A span of time.' },
  // The page the tests are on, so only the current-page rule keeps its links from a preview.
  '/v2/docs/aws-cdk-lib.aws_sns.Topic': { name: 'Topic', kind: 'class', summary: 'A new SNS topic.' },
};

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe('API type hover tooltips', () => {
  let dom: ReturnType<typeof installFakeDocument>;
  let content: FakeElement;
  let fetchMock: jest.Mock<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>;

  /** A link inside the page content, laid out at `left`. */
  function link(path: string, left = 100): FakeElement {
    const anchor = el('a');
    anchor.pathname = path;
    anchor.box = { top: 40, bottom: 60, left, height: 20 };
    content.append(anchor);
    return anchor;
  }

  const tooltip = () => dom.body.children.find((child) => child.id === 'api-type-tooltip');

  async function hover(anchor: FakeElement): Promise<void> {
    dom.dispatch('mouseover', anchor);
    await flush();
  }

  async function install(asset = ASSET) {
    const mod = await import('../docs/.vitepress/theme/type-tooltips.js');
    mod.installTypeTooltips(asset);
  }

  beforeEach(() => {
    jest.resetModules();
    dom = installFakeDocument();
    content = el('div', 'vp-doc');
    dom.body.append(content);
    (globalThis as Record<string, unknown>).window = {
      location: { pathname: '/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Topic.html' },
      innerWidth: 1000,
      addEventListener: (type: string, listener: (event: { target: unknown }) => void) =>
        dom.listeners.set(`window:${type}`, [...(dom.listeners.get(`window:${type}`) ?? []), listener]),
    };
    fetchMock = jest.fn(async () => ({ ok: true, json: async () => SUMMARIES }));
    (globalThis as Record<string, unknown>).fetch = fetchMock;
  });

  afterEach(() => {
    dom.uninstall();
    delete (globalThis as Record<string, unknown>).fetch;
  });

  test('hovering an API link shows its name, kind chip and summary below the link', async () => {
    await install();
    const anchor = link(`/cdk/api${QUEUE}.html`);

    await hover(anchor);

    const tip = tooltip()!;
    expect(fetchMock).toHaveBeenCalledWith(`/cdk/api/api-sidebar/${ASSET}`);
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.getAttribute('aria-hidden')).toBe('false');
    const [head, summary] = tip.children;
    const [name, kind] = head.children;
    expect(name.textContent).toBe('Queue');
    expect(kind.textContent).toBe('L2 construct');
    expect(kind.className).toBe('type-tooltip-kind type-tooltip-kind-l2');
    expect(summary.className).toBe('type-tooltip-summary');
    expect(summary.textContent).toBe('A new Amazon SQS queue.');
    expect(tip.style.top).toBe('68px');
    expect(tip.style.left).toBe('100px');
    expect(anchor.getAttribute('aria-describedby')).toBe('api-type-tooltip');
  });

  test('the kind chip takes its palette from the kind, falls back to the raw kind, and an empty summary is left out', async () => {
    await install();

    await hover(link('/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.QueueProps.html'));
    let [head, ...rest] = tooltip()!.children;
    expect(head.children[1].className).toBe('type-tooltip-kind type-tooltip-kind-struct');
    expect(head.children[1].textContent).toBe('struct');
    expect(rest).toEqual([]);

    await hover(link('/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.QueueEncryption.html'));
    [head] = tooltip()!.children;
    expect(head.children[1].className).toBe('type-tooltip-kind type-tooltip-kind-enum');
    expect(head.children[1].textContent).toBe('Enum');

    await hover(link('/cdk/api/v2/docs/aws-cdk-lib.Duration.html'));
    [head] = tooltip()!.children;
    expect(head.children[1].className).toBe('type-tooltip-kind');
  });

  test('the tooltip stays inside the viewport near the right edge', async () => {
    await install();
    const anchor = link(`/cdk/api${QUEUE}.html`, 950);
    const created = (globalThis as unknown as { document: { createElement: (tag: string) => FakeElement } }).document;
    const original = created.createElement;
    created.createElement = (tag: string) => Object.assign(original(tag), { offsetWidth: 300 });

    await hover(anchor);

    expect(tooltip()!.style.left).toBe(`${1000 - 300 - 8}px`);
  });

  test('the tooltip keeps an 8px margin from the left edge', async () => {
    await install();
    await hover(link(`/cdk/api${QUEUE}.html`, 2));

    expect(tooltip()!.style.left).toBe('8px');
  });

  test('the summaries load once and are reused for later hovers', async () => {
    await install();

    await hover(link(`/cdk/api${QUEUE}.html`));
    dom.dispatch('mouseout', content.children[0]);
    await hover(link('/cdk/api/v2/docs/aws-cdk-lib.Duration.html'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('keyboard focus shows the tooltip and moving focus away hides it', async () => {
    await install();
    const anchor = link(`/cdk/api${QUEUE}.html`);

    dom.dispatch('focusin', anchor);
    await flush();
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('false');

    dom.dispatch('focusout', anchor);
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');
    expect(anchor.hasAttribute('aria-describedby')).toBe(false);
  });

  test('leaving an element other than the hovered link keeps the tooltip', async () => {
    await install();
    const anchor = link(`/cdk/api${QUEUE}.html`);
    await hover(anchor);

    dom.dispatch('mouseout', content);

    expect(tooltip()!.getAttribute('aria-hidden')).toBe('false');
  });

  test('no tooltip for links outside the API docs, permalinks, the outline, the current page or unknown types', async () => {
    await install();
    const permalink = el('a', 'header-anchor');
    permalink.pathname = `/cdk/api${QUEUE}.html`;
    const outline = el('nav', 'VPDocAsideOutline', el('a'));
    outline.children[0].pathname = `/cdk/api${QUEUE}.html`;
    content.append(permalink, outline);

    for (const target of [
      link('/cdk/api/versions.html'),
      permalink,
      outline.children[0],
      link('/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Topic.html'),
      link('/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Missing.html'),
    ]) {
      await hover(target);
    }

    expect(tooltip()).toBeUndefined();
  });

  test('hovering the open link again or a non-link element keeps the tooltip', async () => {
    await install();
    const anchor = link(`/cdk/api${QUEUE}.html`);
    await hover(anchor);

    await hover(anchor);
    await hover(content);

    expect(tooltip()!.getAttribute('aria-hidden')).toBe('false');
    expect(anchor.getAttribute('aria-describedby')).toBe('api-type-tooltip');
  });

  test('moving onto a link without a preview hides the open tooltip', async () => {
    await install();
    await hover(link(`/cdk/api${QUEUE}.html`));

    await hover(link('/cdk/api/versions.html'));

    expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');
  });

  test('a link removed before the summaries arrive gets no tooltip', async () => {
    await install();
    const anchor = link(`/cdk/api${QUEUE}.html`);

    dom.dispatch('mouseover', anchor);
    content.replaceChildren();
    await flush();

    expect(tooltip()).toBeUndefined();
  });

  test('scrolling the page or an ancestor hides the tooltip; scrolling an unrelated pane does not', async () => {
    await install();
    const sidebar = el('aside', 'VPSidebar');
    dom.body.append(sidebar);
    const anchor = link(`/cdk/api${QUEUE}.html`);
    await hover(anchor);

    dom.dispatch('window:scroll', sidebar);
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('false');

    dom.dispatch('window:scroll', content);
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');

    await hover(anchor);
    dom.dispatch('window:scroll', null);
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');
  });

  test('a scroll caused by keyboard focus keeps the tooltip and moves it with the link', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      await install();
      const anchor = link(`/cdk/api${QUEUE}.html`);
      dom.dispatch('focusin', anchor);
      dom.dispatch('window:scroll', null);
      await flush();
      expect(tooltip()!.getAttribute('aria-hidden')).toBe('false');

      anchor.box = { top: 300, bottom: 320, left: 100, height: 20 };
      jest.advanceTimersByTime(100);
      dom.dispatch('window:scroll', content);
      expect(tooltip()!.getAttribute('aria-hidden')).toBe('false');
      expect(tooltip()!.style.top).toBe('328px');

      // Once the focus scroll settles, a reader's scroll hides the tooltip as before.
      jest.advanceTimersByTime(200);
      dom.dispatch('window:scroll', null);
      expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');
    } finally {
      jest.useRealTimers();
    }
  });

  test('hovering a link after a focus move ends the focus scroll, so a scroll hides the tooltip', async () => {
    await install();
    dom.dispatch('focusin', link(`/cdk/api${QUEUE}.html`));
    await hover(link('/cdk/api/v2/docs/aws-cdk-lib.Duration.html'));

    dom.dispatch('window:scroll', null);
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');
  });

  test('Escape hides the open tooltip; other keys and an Escape with nothing open do nothing', async () => {
    await install();
    dom.dispatch('keydown', null, { key: 'Escape' });
    expect(tooltip()).toBeUndefined();

    const anchor = link(`/cdk/api${QUEUE}.html`);
    dom.dispatch('focusin', anchor);
    await flush();
    dom.dispatch('keydown', anchor, { key: 'Tab' });
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('false');

    dom.dispatch('keydown', anchor, { key: 'Escape' });
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');
    expect(anchor.hasAttribute('aria-describedby')).toBe(false);
  });

  test('a failed or missing summaries file shows no tooltip', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => SUMMARIES });
    await install();
    await hover(link(`/cdk/api${QUEUE}.html`));
    expect(tooltip()).toBeUndefined();

    jest.resetModules();
    fetchMock.mockRejectedValue(new Error('offline'));
    await install();
    await hover(link(`/cdk/api${QUEUE}.html`));
    expect(tooltip()).toBeUndefined();
  });

  test('an empty asset name disables the lookup', async () => {
    await install('');
    await hover(link(`/cdk/api${QUEUE}.html`));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(tooltip()).toBeUndefined();
  });

  test('without a window nothing is installed', async () => {
    delete (globalThis as Record<string, unknown>).window;
    await install();

    expect(dom.listeners.size).toBe(0);
  });
});
