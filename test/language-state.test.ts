import { jest } from '@jest/globals';

// Node-env Jest has no DOM, so each test installs the window surface the module touches.
describe('shared language state', () => {
  let store: Record<string, string>;
  let href: string;
  let replaced: Array<{ state: unknown; url: string }>;

  function installWindow(url: string): void {
    href = url;
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
      location: {
        get href() {
          return href;
        },
        get search() {
          return new URL(href).search;
        },
      },
      history: {
        state: { scroll: 120 },
        replaceState: (state: unknown, _title: string, next: URL) => {
          replaced.push({ state, url: next.toString() });
          href = next.toString();
        },
      },
    };
  }

  beforeEach(() => {
    jest.resetModules();
    store = {};
    replaced = [];
    installWindow('https://example.com/v2/docs/aws-cdk-lib.aws_sqs.Queue.html#props');
    (globalThis as Record<string, unknown>).document = {
      createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
  });

  const load = () => import('../docs/.vitepress/theme/language-state.js');

  test('defaults to TypeScript when neither the URL nor storage names a language', async () => {
    const mod = await load();
    mod.initLanguageState();

    expect(mod.activeLanguage.value).toBe('ts');
  });

  test('a ?lang= link wins over the stored preference', async () => {
    installWindow('https://example.com/v2/docs/aws-cdk-lib.aws_sqs.Queue.html?lang=python');
    store['cdk-docs-language'] = 'java';
    const mod = await load();
    mod.initLanguageState();

    expect(mod.activeLanguage.value).toBe('python');
  });

  test('the stored preference applies when the link has no usable ?lang=', async () => {
    installWindow('https://example.com/v2/docs/aws-cdk-lib.aws_sqs.Queue.html?lang=cobol');
    store['cdk-docs-language'] = 'java';
    const mod = await load();
    mod.initLanguageState();

    expect(mod.activeLanguage.value).toBe('java');
  });

  test('an unknown stored value is ignored', async () => {
    store['cdk-docs-language'] = 'cobol';
    const mod = await load();
    mod.initLanguageState();

    expect(mod.activeLanguage.value).toBe('ts');
  });

  test('initializing twice does not re-read the URL or storage', async () => {
    const mod = await load();
    mod.initLanguageState();
    store['cdk-docs-language'] = 'go';
    mod.initLanguageState();

    expect(mod.activeLanguage.value).toBe('ts');
  });

  test('choosing a language stores it and puts it in the URL, keeping the hash and history state', async () => {
    const mod = await load();
    mod.setLanguage('dotnet');

    expect(mod.activeLanguage.value).toBe('dotnet');
    expect(store).toEqual({ 'cdk-docs-language': 'dotnet' });
    expect(replaced).toEqual([
      { state: { scroll: 120 }, url: 'https://example.com/v2/docs/aws-cdk-lib.aws_sqs.Queue.html?lang=dotnet#props' },
    ]);

    mod.setLanguage('go');
    expect(replaced.at(-1)?.url).toBe('https://example.com/v2/docs/aws-cdk-lib.aws_sqs.Queue.html?lang=go#props');
  });

  test('without a window the state changes but nothing is stored or rewritten', async () => {
    delete (globalThis as Record<string, unknown>).window;
    const mod = await load();

    mod.initLanguageState();
    mod.setLanguage('python');

    expect(mod.activeLanguage.value).toBe('python');
    expect(store).toEqual({});
    expect(replaced).toEqual([]);
  });

  test('re-exports the language vocabulary in display order', async () => {
    const mod = await load();
    const core = await import('../docs/.vitepress/theme/languages-core.js');

    expect(mod.LANGUAGE_ORDER).toBe(core.LANGUAGE_ORDER);
    expect(mod.LANGUAGE_LABELS).toBe(core.LANGUAGE_LABELS);
  });
});
