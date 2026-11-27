import { el, FakeElement, installFakeDocument } from './fake-dom.js';

const { COVERED_ATTR, PINNED_ATTR, STICKY_TOP_VAR, StickyHeadings, enclosingStickyHeight, headingOf } = await import(
  '../docs/.vitepress/theme/sidebar-sticky.js'
);

/** Records every observer the module creates, so a test can read its options and feed it entries. */
class FakeIntersectionObserver {
  static all: FakeIntersectionObserver[] = [];
  readonly observed = new Set<FakeElement>();
  disconnected = false;
  constructor(
    readonly callback: (entries: unknown[]) => void,
    readonly options: { root: FakeElement; rootMargin: string; threshold?: number[] },
  ) {
    FakeIntersectionObserver.all.push(this);
  }
  observe(target: FakeElement) {
    this.observed.add(target);
  }
  unobserve(target: FakeElement) {
    this.observed.delete(target);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  fire(...entries: Array<[FakeElement, boolean, number?]>) {
    this.callback(entries.map(([target, isIntersecting, intersectionRatio = isIntersecting ? 1 : 0]) => ({
      target,
      isIntersecting,
      intersectionRatio,
    })));
  }
}

class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  readonly observed: FakeElement[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.all.push(this);
  }
  observe(target: FakeElement) {
    this.observed.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
}

/** An eligible group `<li>` whose first child is its heading button, `height` px tall. */
function group(name: string, height: number, ...children: FakeElement[]): FakeElement {
  const heading = el('button', 'api-sidebar-group');
  heading.textContent = name;
  heading.box = { top: 0, bottom: height, left: 0, height };
  return el('li', 'api-sidebar-item', heading, el('ul', '', ...children));
}

const heading = (li: FakeElement) => li.children[0];

let dom: ReturnType<typeof installFakeDocument>;
let container: FakeElement;
let header: FakeElement;
let service: FakeElement;
let resource: FakeElement;
let other: FakeElement;

const lineObserver = () => FakeIntersectionObserver.all.filter((o) => !o.options.threshold).at(-1)!;
const headingObserver = () => FakeIntersectionObserver.all.filter((o) => o.options.threshold).at(-1)!;

beforeEach(() => {
  dom = installFakeDocument();
  FakeIntersectionObserver.all = [];
  FakeResizeObserver.all = [];
  const globals = globalThis as Record<string, unknown>;
  globals.IntersectionObserver = FakeIntersectionObserver;
  globals.ResizeObserver = FakeResizeObserver;
  header = el('div', 'sidebar-header');
  header.box = { top: 10, bottom: 78, left: 0, height: 68 };
  resource = group('Queue', 30);
  service = group('Amazon SQS', 44, resource);
  other = group('Amazon SNS', 28);
  container = el('nav', 'VPSidebar', header, el('ul', '', service, other));
  container.box = { top: 10, bottom: 546, left: 0, height: 536 };
  container.clientHeight = 536;
  dom.body.append(container);
});

afterEach(() => {
  dom.uninstall();
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
  delete (globalThis as Record<string, unknown>).ResizeObserver;
});

function attached() {
  const sticky = new StickyHeadings();
  for (const li of [service, resource, other]) sticky.register(li as unknown as HTMLElement);
  sticky.attach(container as unknown as HTMLElement);
  return sticky;
}

describe('StickyHeadings', () => {
  test('pins headings at the header height and cuts both observers to the line under it', () => {
    const sticky = attached();

    expect(container.style[STICKY_TOP_VAR]).toBe('68px');
    expect(sticky.headerOffset()).toBe(68);
    expect(lineObserver().options).toEqual({ root: container, rootMargin: '-68px 0px -467px 0px' });
    expect(headingObserver().options).toEqual({ root: container, rootMargin: '-67px 0px 0px 0px', threshold: [1] });
    expect([...lineObserver().observed]).toEqual([service, resource, other]);
    expect([...headingObserver().observed]).toEqual([service, resource, other].map(heading));
    expect(FakeResizeObserver.all[0].observed).toEqual([container, header]);
  });

  test('pins the deepest group spanning the band and hides its ancestor behind it', () => {
    const sticky = attached();

    lineObserver().fire([service, true], [resource, true]);
    headingObserver().fire([heading(service), true], [heading(resource), true]);

    expect(resource.hasAttribute(PINNED_ATTR)).toBe(true);
    expect(service.hasAttribute(COVERED_ATTR)).toBe(true);
    expect(service.hasAttribute(PINNED_ATTR)).toBe(false);
    expect(sticky.pinnedHeight()).toBe(30);
    expect(container.style.scrollPaddingTop).toBe('98px');
  });

  test('a heading being pushed away hands the band back to its ancestor', () => {
    attached();
    lineObserver().fire([service, true], [resource, true]);
    headingObserver().fire([heading(service), true], [heading(resource), true]);

    headingObserver().fire([heading(resource), true, 0.6]);

    expect(resource.hasAttribute(PINNED_ATTR)).toBe(false);
    expect(service.hasAttribute(PINNED_ATTR)).toBe(true);
    expect(service.hasAttribute(COVERED_ATTR)).toBe(false);
    expect(container.style.scrollPaddingTop).toBe('112px');
  });

  test('a group leaving the band is no longer pinned', () => {
    const sticky = attached();
    lineObserver().fire([other, true]);
    headingObserver().fire([heading(other), true]);
    expect(other.hasAttribute(PINNED_ATTR)).toBe(true);

    lineObserver().fire([other, false]);

    expect(other.hasAttribute(PINNED_ATTR)).toBe(false);
    expect(sticky.pinnedHeight()).toBe(0);
    expect(container.style.scrollPaddingTop).toBe('68px');
  });

  test('unregistering the pinned group clears its marks and re-resolves the band', () => {
    const sticky = attached();
    lineObserver().fire([service, true], [resource, true]);
    headingObserver().fire([heading(service), true], [heading(resource), true]);

    sticky.unregister(resource as unknown as HTMLElement);

    expect(resource.hasAttribute(PINNED_ATTR)).toBe(false);
    expect(lineObserver().observed.has(resource)).toBe(false);
    expect(headingObserver().observed.has(heading(resource))).toBe(false);
    expect(service.hasAttribute(PINNED_ATTR)).toBe(true);
    expect(service.hasAttribute(COVERED_ATTR)).toBe(false);
  });

  test('a resize re-measures the header and re-observes every group', () => {
    const sticky = attached();
    lineObserver().fire([other, true]);
    headingObserver().fire([heading(other), true]);
    const first = lineObserver();

    header.box = { top: 10, bottom: 178, left: 0, height: 168 };
    FakeResizeObserver.all[0].callback();

    expect(first.disconnected).toBe(true);
    expect(container.style[STICKY_TOP_VAR]).toBe('168px');
    expect(sticky.headerOffset()).toBe(168);
    expect(lineObserver().options.rootMargin).toBe('-168px 0px -367px 0px');
    expect([...lineObserver().observed]).toEqual([service, resource, other]);
  });

  test('detaching disconnects the observers and clears the variable and every mark', () => {
    const sticky = attached();
    lineObserver().fire([service, true], [resource, true]);
    headingObserver().fire([heading(service), true], [heading(resource), true]);

    sticky.detach();

    expect(FakeIntersectionObserver.all.every((o) => o.disconnected)).toBe(true);
    expect(FakeResizeObserver.all[0].disconnected).toBe(true);
    expect(STICKY_TOP_VAR in container.style).toBe(false);
    expect(resource.hasAttribute(PINNED_ATTR)).toBe(false);
    expect(service.hasAttribute(COVERED_ATTR)).toBe(false);
  });

  test('attaching to the same container again changes nothing', () => {
    const sticky = attached();
    const created = FakeIntersectionObserver.all.length;

    sticky.attach(container as unknown as HTMLElement);

    expect(FakeIntersectionObserver.all).toHaveLength(created);
  });

  test('without a header block headings pin at the top', () => {
    container.replaceChildren();
    container.append(el('ul', '', service));
    const sticky = new StickyHeadings();
    sticky.register(service as unknown as HTMLElement);
    sticky.attach(container as unknown as HTMLElement);

    expect(container.style[STICKY_TOP_VAR]).toBe('0px');
    expect(lineObserver().options.rootMargin).toBe('-0px 0px -535px 0px');
    expect(FakeResizeObserver.all[0].observed).toEqual([container]);
  });

  test('a browser without the observers gets no pinned band', () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;
    const sticky = attached();

    expect(STICKY_TOP_VAR in container.style).toBe(false);
    expect(sticky.headerOffset()).toBe(0);
  });

  test('a browser without ResizeObserver gets no pinned band', () => {
    delete (globalThis as Record<string, unknown>).ResizeObserver;
    const sticky = attached();

    expect(STICKY_TOP_VAR in container.style).toBe(false);
    expect(FakeIntersectionObserver.all).toHaveLength(0);
    expect(sticky.headerOffset()).toBe(0);
  });

  test('a group with no heading button is never observed', () => {
    const bare = el('li', 'api-sidebar-item', el('a'));
    const sticky = attached();

    sticky.register(bare as unknown as HTMLElement);

    expect(lineObserver().observed.has(bare)).toBe(false);
  });
});

describe('headingOf', () => {
  test('is the group heading button that starts the item, and nothing else', () => {
    expect(headingOf(service as unknown as Element)).toBe(heading(service));
    expect(headingOf(el('li', '', el('a', 'api-sidebar-link')) as unknown as Element)).toBeNull();
    expect(headingOf(el('li') as unknown as Element)).toBeNull();
  });
});

describe('enclosingStickyHeight', () => {
  test('is the height of the nearest enclosing group heading', () => {
    const entry = el('li', 'api-sidebar-item', el('a', 'api-sidebar-link'));
    resource.children[1].append(entry);

    expect(enclosingStickyHeight(entry.children[0] as unknown as Element)).toBe(30);
  });

  test('skips kind groups, which never stick', () => {
    const entry = el('li', 'api-sidebar-item', el('a', 'api-sidebar-link'));
    const kind = group('Constructs', 22, entry);
    kind.setAttribute('data-kind-group', '');
    resource.children[1].append(kind);

    expect(enclosingStickyHeight(entry.children[0] as unknown as Element)).toBe(30);
  });

  test('is 0 for an entry at the top level', () => {
    const entry = el('li', 'api-sidebar-item', el('a', 'api-sidebar-link'));
    container.children[1].append(entry);

    expect(enclosingStickyHeight(entry.children[0] as unknown as Element)).toBe(0);
  });
});
