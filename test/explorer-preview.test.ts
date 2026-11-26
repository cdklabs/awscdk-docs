import { jest } from '@jest/globals';

// Explorer preview state module: the switch and the selected view, stored in localStorage and mirrored
// as attributes on <html> so the preview's CSS can key on them before the app hydrates.
describe('explorer preview state', () => {
  let store: Record<string, string>;
  let attributes: Record<string, string>;

  beforeEach(() => {
    jest.resetModules();
    store = {};
    attributes = {};
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
    };
    (globalThis as Record<string, unknown>).document = {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          attributes[k] = v;
        },
        removeAttribute: (k: string) => {
          delete attributes[k];
        },
      },
      // Vue's runtime-dom touches document.createElement at import time.
      createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
  });

  test('a reader who never opened the switch gets the preview off, the API view and no attributes', async () => {
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    mod.initExplorerPreview();
    expect(mod.explorerPreview.value).toBe('off');
    expect(mod.explorerView.value).toBe('api');
    expect(attributes).toEqual({});
  });

  test('a stored on choice and a stored view are read on init and set both attributes', async () => {
    store['cdk-docs-explorer-preview'] = 'on';
    store['cdk-docs-explorer-view'] = 'favorites';
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    mod.initExplorerPreview();
    expect(mod.explorerPreview.value).toBe('on');
    expect(mod.explorerView.value).toBe('favorites');
    expect(attributes).toEqual({ 'data-explorer-preview': 'on', 'data-explorer-view': 'favorites' });
  });

  test('unknown stored values fall back to off and the API view', async () => {
    store['cdk-docs-explorer-preview'] = 'yes';
    store['cdk-docs-explorer-view'] = 'tree';
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    mod.initExplorerPreview();
    expect(mod.explorerPreview.value).toBe('off');
    expect(mod.explorerView.value).toBe('api');
    expect(attributes).toEqual({});
  });

  test('turning the preview on persists it, selects the API view and sets the attributes', async () => {
    store['cdk-docs-explorer-view'] = 'favorites';
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    mod.initExplorerPreview();
    mod.setExplorerPreview('on');
    expect(store['cdk-docs-explorer-preview']).toBe('on');
    expect(store['cdk-docs-explorer-view']).toBe('api');
    expect(attributes).toEqual({ 'data-explorer-preview': 'on', 'data-explorer-view': 'api' });
  });

  test('turning the preview off persists it and removes both attributes', async () => {
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    mod.setExplorerPreview('on');
    mod.setExplorerPreview('off');
    expect(store['cdk-docs-explorer-preview']).toBe('off');
    expect(attributes).toEqual({});
  });

  test('selecting a view persists it and updates the attribute', async () => {
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    mod.setExplorerPreview('on');
    mod.setExplorerView('favorites');
    expect(mod.explorerView.value).toBe('favorites');
    expect(store['cdk-docs-explorer-view']).toBe('favorites');
    expect(attributes['data-explorer-view']).toBe('favorites');
  });

  test('turning the preview on folds an unfolded rail', async () => {
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    mod.railOpen.value = true;
    mod.setExplorerPreview('on');
    expect(mod.railOpen.value).toBe(false);
  });

  test('a throwing storage leaves the choice in effect for the session', async () => {
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    };
    const mod = await import('../docs/.vitepress/theme/explorer-preview.js');
    expect(() => mod.initExplorerPreview()).not.toThrow();
    expect(() => mod.setExplorerPreview('on')).not.toThrow();
    expect(mod.explorerPreview.value).toBe('on');
    expect(attributes['data-explorer-preview']).toBe('on');
  });
});
