import { jest } from '@jest/globals';

// Node-env Jest has no DOM, so each test installs the window/document surface the module touches.
describe('code-block theme state', () => {
  let store: Record<string, string>;
  let attrs: Record<string, string>;

  beforeEach(() => {
    jest.resetModules();
    store = {};
    attrs = {};
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
    };
    (globalThis as Record<string, unknown>).document = {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attrs[name] = value;
        },
        removeAttribute: (name: string) => {
          delete attrs[name];
        },
      },
      createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
  });

  const load = () => import('../docs/.vitepress/theme/code-theme.js');

  test('with nothing stored the code theme follows the site theme and sets no attribute', async () => {
    const mod = await load();
    mod.initCodeTheme();

    expect(mod.codeTheme.value).toBe('auto');
    expect(attrs).toEqual({});
  });

  test('a stored decoupled choice is read back and applied to <html>', async () => {
    store['cdk-docs-code-theme'] = 'dark';
    const mod = await load();
    mod.initCodeTheme();

    expect(mod.codeTheme.value).toBe('dark');
    expect(attrs).toEqual({ 'data-code-theme': 'dark' });
  });

  test('an unknown stored value is ignored', async () => {
    store['cdk-docs-code-theme'] = 'sepia';
    const mod = await load();
    mod.initCodeTheme();

    expect(mod.codeTheme.value).toBe('auto');
    expect(attrs).toEqual({});
  });

  test('initializing twice does not re-read storage', async () => {
    const mod = await load();
    mod.initCodeTheme();
    store['cdk-docs-code-theme'] = 'light';
    mod.initCodeTheme();

    expect(mod.codeTheme.value).toBe('auto');
    expect(attrs).toEqual({});
  });

  test('setting a theme stores it and sets the attribute; Default stores auto and removes it', async () => {
    const mod = await load();

    mod.setCodeTheme('light');
    expect(store).toEqual({ 'cdk-docs-code-theme': 'light' });
    expect(attrs).toEqual({ 'data-code-theme': 'light' });

    mod.setCodeTheme('auto');
    expect(mod.codeTheme.value).toBe('auto');
    expect(store).toEqual({ 'cdk-docs-code-theme': 'auto' });
    expect(attrs).toEqual({});
  });

  test('without a window the state changes but nothing is stored or applied', async () => {
    delete (globalThis as Record<string, unknown>).window;
    const mod = await load();

    mod.initCodeTheme();
    mod.setCodeTheme('dark');

    expect(mod.codeTheme.value).toBe('dark');
    expect(store).toEqual({});
    expect(attrs).toEqual({});
  });
});
