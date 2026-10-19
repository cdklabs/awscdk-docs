import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  apiPathFrom,
  COLLAPSED_STORAGE_KEY,
  FavoritesStore,
  MAX_FAVORITES,
  normalizePath,
  rankFavoritesFirst,
  readCollapsed,
  STORAGE_KEY,
  StorageLike,
  writeCollapsed,
} from '../docs/.vitepress/theme/favorites.js';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const bucket = {
  path: '/api/modules/ts/aws-cdk-lib/aws-s3/Bucket',
  title: 'Bucket',
};
const queue = {
  path: '/api/modules/ts/aws-cdk-lib/aws-sqs/Queue',
  title: 'Queue',
};

describe('favorite pages', () => {
  describe('star/unstar logic', () => {
    test('add stars a page and isFavorite reflects it', () => {
      const store = new FavoritesStore(new FakeStorage());
      expect(store.add(bucket)).toBe(true);
      expect(store.isFavorite(bucket.path)).toBe(true);
      expect(store.isFavorite(queue.path)).toBe(false);
    });

    test('add refuses duplicates', () => {
      const store = new FavoritesStore(new FakeStorage());
      expect(store.add(bucket)).toBe(true);
      expect(store.add(bucket)).toBe(false);
      expect(store.list()).toHaveLength(1);
    });

    test('remove unstars a page', () => {
      const store = new FavoritesStore(new FakeStorage());
      store.add(bucket);
      expect(store.remove(bucket.path)).toBe(true);
      expect(store.isFavorite(bucket.path)).toBe(false);
      expect(store.remove(bucket.path)).toBe(false);
    });

    test('toggle stars then unstars', () => {
      const store = new FavoritesStore(new FakeStorage());
      expect(store.toggle(bucket)).toEqual({ favorited: true, rejected: false });
      expect(store.toggle(bucket)).toEqual({ favorited: false, rejected: false });
    });

    test('cap: adding beyond MAX_FAVORITES is rejected', () => {
      const store = new FavoritesStore(new FakeStorage());
      for (let i = 0; i < MAX_FAVORITES; i++) {
        expect(store.add({ path: `/api/page-${i}`, title: `Page ${i}` })).toBe(true);
      }
      expect(store.add(bucket)).toBe(false);
      expect(store.toggle(bucket)).toEqual({ favorited: false, rejected: true });
      expect(store.list()).toHaveLength(MAX_FAVORITES);
    });

    test('subscribe notifies on changes and unsubscribe stops it', () => {
      const store = new FavoritesStore(new FakeStorage());
      const seen: number[] = [];
      const unsubscribe = store.subscribe((entries) => seen.push(entries.length));
      store.add(bucket);
      store.remove(bucket.path);
      unsubscribe();
      store.add(queue);
      expect(seen).toEqual([1, 0]);
    });
  });

  describe('persistence', () => {
    test('favorites round-trip through storage', () => {
      const storage = new FakeStorage();
      const first = new FavoritesStore(storage);
      first.add(bucket);
      first.add(queue);

      const second = new FavoritesStore(storage);
      expect(second.list()).toEqual([bucket, queue]);
    });

    test('works without any storage (SSR)', () => {
      const store = new FavoritesStore(undefined);
      expect(store.add(bucket)).toBe(true);
      expect(store.isFavorite(bucket.path)).toBe(true);
    });

    test('corrupt stored JSON is discarded, not thrown', () => {
      const storage = new FakeStorage();
      storage.setItem(STORAGE_KEY, '{not json');
      expect(new FavoritesStore(storage).list()).toEqual([]);
      storage.setItem(STORAGE_KEY, '{"a":1}');
      expect(new FavoritesStore(storage).list()).toEqual([]);
      storage.setItem(STORAGE_KEY, '[{"path":1,"title":2},{"path":"/api/x","title":"X"}]');
      expect(new FavoritesStore(storage).list()).toEqual([
        { path: '/api/x', title: 'X' },
      ]);
    });

    test('stored entries beyond the cap are truncated on load', () => {
      const storage = new FakeStorage();
      const oversized = Array.from({ length: MAX_FAVORITES + 5 }, (_, i) => ({
        path: `/api/page-${i}`,
        title: `Page ${i}`,
      }));
      storage.setItem(STORAGE_KEY, JSON.stringify(oversized));
      expect(new FavoritesStore(storage).list()).toHaveLength(MAX_FAVORITES);
    });

    test('reload picks up external storage changes (cross-tab sync)', () => {
      const storage = new FakeStorage();
      const store = new FavoritesStore(storage);
      storage.setItem(STORAGE_KEY, JSON.stringify([bucket]));
      expect(store.list()).toEqual([]);
      store.reload();
      expect(store.list()).toEqual([bucket]);
    });
  });

  describe('path normalization', () => {
    test('strips .html so route and link forms match', () => {
      expect(normalizePath('/api/modules/ts/x/Y.html')).toBe('/api/modules/ts/x/Y');
    });

    test('collapses trailing index to the directory form', () => {
      expect(normalizePath('/api/index.html')).toBe('/api/');
      expect(normalizePath('/api/index')).toBe('/api/');
    });

    test('isFavorite matches across .html and clean forms', () => {
      const store = new FavoritesStore(new FakeStorage());
      store.add({ path: `${bucket.path}.html`, title: bucket.title });
      expect(store.isFavorite(bucket.path)).toBe(true);
    });

    test('apiPathFrom extracts base-stripped api paths from result URLs', () => {
      expect(apiPathFrom('/cdk-docs/v2/modules/ts/x/Y.html')).toBe('/v2/modules/ts/x/Y');
      expect(apiPathFrom('/cdk-docs/v2/modules/ts/x/Y.html#anchor')).toBe('/v2/modules/ts/x/Y');
      expect(apiPathFrom('/cdk-docs/versions.html')).toBeUndefined();
    });

    test('apiPathFrom strips the hosted base that route paths carry', () => {
      expect(apiPathFrom('/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Topic.html')).toBe(
        '/v2/docs/aws-cdk-lib.aws_sns.Topic',
      );
      expect(apiPathFrom('/cdk/api/v2/')).toBe('/v2/');
      expect(apiPathFrom('/v2/docs/aws-cdk-lib.aws_sns.Topic.html')).toBe(
        '/v2/docs/aws-cdk-lib.aws_sns.Topic',
      );
      expect(apiPathFrom('/cdk/api/versions.html')).toBeUndefined();
    });
  });

  describe('search boosting', () => {
    test('rankFavoritesFirst moves starred items to the front, stably', () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const starred = new Set(['d', 'b']);
      expect(rankFavoritesFirst(items, (i) => starred.has(i))).toEqual([
        'b', 'd', 'a', 'c', 'e',
      ]);
    });

    test('rankFavoritesFirst is a no-op without favorites', () => {
      const items = ['a', 'b', 'c'];
      expect(rankFavoritesFirst(items, () => false)).toEqual(items);
    });

    test('client module exposes the shared store and the search dialog ranks favorites first', () => {
      const source = readFileSync(resolve(THEME_DIR, 'favorites-client.ts'), 'utf-8');
      expect(source).toContain('__cdkDocsFavorites');
      expect(source).not.toContain('__pagefind__');
      const searchBox = readFileSync(resolve(THEME_DIR, 'SearchBox.vue'), 'utf-8');
      expect(searchBox).toContain('rankFavoritesFirst');
      expect(searchBox).toContain('isFavorite');
    });
  });

  describe('theme wiring', () => {
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');

    test('star toggle renders through the doc-before layout slot', () => {
      expect(entry).toContain('"doc-before": () => h(FavoriteStar)');
    });

    test('favorites section renders through the sidebar-nav-before slot', () => {
      // The sidebar-nav-before slot hosts both the symbol filter and the
      // favorites list, and the slot's children sit inside one
      // `.sidebar-header` wrapper so they can be pinned as a block — so this
      // asserts the mount rather than the slot's exact expression.
      const mount = /"sidebar-nav-before":\s*\(\)\s*=>\s*([\s\S]*?)\n      "doc-before"/.exec(
        entry,
      );
      expect(mount).not.toBeNull();
      expect(mount![1]).toContain('h(FavoritesList)');
      expect(mount![1]).toContain('class: "sidebar-header"');
    });

    test('search boost is installed in enhanceApp', () => {
      expect(entry).toContain('installFavoritesSearchBoost()');
    });

    test('favorites stylesheet is loaded', () => {
      expect(entry).toContain('./favorites.css');
    });

    test('star component reflects state via aria-pressed and both icons', () => {
      const star = readFileSync(resolve(THEME_DIR, 'FavoriteStar.vue'), 'utf-8');
      expect(star).toContain(':aria-pressed="starred"');
      expect(star).toContain('★');
      expect(star).toContain('☆');
    });

    test('star derives its page path without knowing the api root, so a site base cannot hide it', () => {
      const star = readFileSync(resolve(THEME_DIR, 'FavoriteStar.vue'), 'utf-8');
      expect(star).toContain('apiPathFrom(route.path)');
      expect(star).not.toContain('API_ROOT');
      expect(star).not.toMatch(/['"]\/v2\//);
    });

    test('sidebar component supports unstar per item', () => {
      const list = readFileSync(resolve(THEME_DIR, 'FavoritesList.vue'), 'utf-8');
      expect(list).toContain('favorites-remove');
      expect(list).toContain('unstar');
    });

    test('favorites styling uses only theme variables (light + dark safe)', () => {
      const css = readFileSync(resolve(THEME_DIR, 'favorites.css'), 'utf-8');
      expect(css).toContain('var(--vp-c-brand-1)');
      expect(css).toContain('var(--vp-c-bg-soft)');
      // No hard-coded colors that would break one of the two modes.
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

  });

  describe('collapsed state', () => {
    test('collapsed by default when storage holds no preference', () => {
      expect(readCollapsed(new FakeStorage())).toBe(true);
      // Also with no storage at all (SSR): the section must not render
      // expanded on a first paint and then collapse.
      expect(readCollapsed(undefined)).toBe(true);
    });

    test('an explicit choice round-trips and survives a fresh read', () => {
      const storage = new FakeStorage();
      writeCollapsed(false, storage);
      expect(readCollapsed(storage)).toBe(false);
      writeCollapsed(true, storage);
      expect(readCollapsed(storage)).toBe(true);
    });

    test('the preference lives under its own key, leaving the entry list untouched', () => {
      const storage = new FakeStorage();
      const store = new FavoritesStore(storage);
      store.add(bucket);
      writeCollapsed(false, storage);
      expect(storage.getItem(COLLAPSED_STORAGE_KEY)).not.toBeNull();
      // The entries key still parses as the entry array — the collapse flag
      // did not change the stored shape of the favorites themselves.
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual([
        { path: bucket.path, title: bucket.title },
      ]);
      expect(new FavoritesStore(storage).list()).toHaveLength(1);
    });

    test('unparseable or absent values fall back to collapsed', () => {
      const storage = new FakeStorage();
      storage.setItem(COLLAPSED_STORAGE_KEY, 'not-a-boolean');
      expect(readCollapsed(storage)).toBe(true);
    });

    test('the section header is a keyboard-operable disclosure showing the count', () => {
      const list = readFileSync(resolve(THEME_DIR, 'FavoritesList.vue'), 'utf-8');
      // A real <button> (Enter/Space and tab order come free) wired to the
      // same aria contract the nav tree's groups use.
      expect(list).toMatch(/<button[^>]*class="favorites-toggle"/s);
      expect(list).toContain(':aria-expanded=');
      // `aria-controls` is a static attribute: the list id is constant, so
      // there is nothing to bind.
      expect(list).toMatch(/aria-controls="favorites-list"/);
      expect(list).toMatch(/id="favorites-list"/);
      // Count stays visible while collapsed so the feature is discoverable.
      expect(list).toContain('entries.length');
      // Same caret convention as ApiSidebarItem rather than a second style.
      expect(list).toContain('favorites-caret');
    });

    test('entry labels use the nav tree font size rather than a smaller one', () => {
      const css = readFileSync(resolve(THEME_DIR, 'favorites.css'), 'utf-8');
      const link = /\.favorites-link\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
      expect(link).toContain('font-size: 14px');
      expect(link).not.toContain('font-size: 13px');
    });
  });
});
