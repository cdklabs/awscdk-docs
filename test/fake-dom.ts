// A small element tree for theme modules under node-env Jest, which has no DOM. It covers only what those modules
// call: attributes, classes, children, `closest` on tag, class and attribute selectors, `contains`, and a box.

interface Box {
  top: number;
  bottom: number;
  left: number;
  height: number;
}

/** One simple selector: `tag`, `.class`, `[attr]`, or a tag with classes, such as `li.api-sidebar-item`. */
function matchesOne(node: FakeElement, selector: string): boolean {
  const attr = /^\[([\w-]+)\]$/.exec(selector);
  if (attr) {
    return node.hasAttribute(attr[1]);
  }
  const [tag, ...classes] = selector.split('.');
  return (tag === '' || node.tagName === tag.toUpperCase()) && classes.every((name) => node.classList.contains(name));
}

export class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> & {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  textContent = '';
  id = '';
  pathname = '';
  box: Box = { top: 0, bottom: 0, left: 0, height: 0 };
  offsetWidth = 0;
  clientTop = 0;
  clientHeight = 0;
  private classes = new Set<string>();

  constructor(tag: string, className = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    const style = {} as Record<string, string>;
    Object.defineProperty(style, 'setProperty', { value: (name: string, value: string) => (style[name] = value) });
    Object.defineProperty(style, 'removeProperty', { value: (name: string) => delete style[name] });
    this.style = style as FakeElement['style'];
  }

  get className(): string {
    return [...this.classes].join(' ');
  }

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  get classList() {
    return { contains: (name: string) => this.classes.has(name) };
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  get isConnected(): boolean {
    let root: FakeElement = this;
    while (root.parentElement) {
      root = root.parentElement;
    }
    return root.tagName === 'HTML';
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  appendChild(node: FakeElement): FakeElement {
    this.append(node);
    return node;
  }

  replaceChildren(): void {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children.length = 0;
  }

  contains(other: FakeElement | null): boolean {
    for (let node = other; node; node = node.parentElement) {
      if (node === this) {
        return true;
      }
    }
    return false;
  }

  /** `closest` for a comma-separated list of simple selectors. */
  closest(selectors: string): FakeElement | null {
    const list = selectors.split(',').map((s) => s.trim());
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      if (list.some((selector) => matchesOne(node!, selector))) {
        return node;
      }
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (matchesOne(child, selector)) {
        return child;
      }
      const deeper = child.querySelector(selector);
      if (deeper) {
        return deeper;
      }
    }
    return null;
  }

  getBoundingClientRect(): Box {
    return this.box;
  }
}

/** Build an element with children in one call. */
export function el(tag: string, className = '', ...children: FakeElement[]): FakeElement {
  const element = new FakeElement(tag, className);
  element.append(...children);
  return element;
}

type Listener = (event: { target: unknown }) => void;

/** A document whose `<html>` holds a `<body>`, recording its listeners so a test can dispatch events. */
export function installFakeDocument(): {
  html: FakeElement;
  body: FakeElement;
  listeners: Map<string, Listener[]>;
  dispatch(type: string, target: unknown): void;
  uninstall(): void;
} {
  const body = new FakeElement('body');
  const html = el('html', '', body);
  const listeners = new Map<string, Listener[]>();
  const listen = (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  const globals = globalThis as Record<string, unknown>;
  globals.Element = FakeElement;
  globals.HTMLElement = FakeElement;
  globals.document = {
    documentElement: html,
    body,
    createElement: (tag: string) => new FakeElement(tag),
    addEventListener: listen,
  };
  return {
    html,
    body,
    listeners,
    dispatch: (type, target) => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ target });
      }
    },
    uninstall: () => {
      for (const name of ['Element', 'HTMLElement', 'document', 'window']) {
        delete globals[name];
      }
    },
  };
}
