import { readFileSync } from 'fs';
import { resolve } from 'path';
import { withFavoritesSearchBoost } from '../docs/.vitepress/theme/favorites-client.js';
import {
  apiPathFrom,
  ALIASES_STORAGE_KEY,
  categoryFor,
  COLLAPSED_GROUPS_STORAGE_KEY,
  COLLAPSED_STORAGE_KEY,
  FavoritesStore,
  GROUPS_STORAGE_KEY,
  normalizePath,
  pageId,
  rankFavoritesFirst,
  readCollapsed,
  serviceNameFor,
  STORAGE_KEY,
  StorageLike,
  UNGROUPED,
  writeCollapsed,
} from '../docs/.vitepress/theme/favorites.js';
import {
  MAX_SEARCH_CANDIDATES,
  MAX_SEARCH_RESULTS,
} from '../docs/.vitepress/theme/search-client.js';

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
  path: '/v2/docs/aws-cdk-lib.aws_s3.Bucket',
  title: 'Bucket',
};
const queue = {
  path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue',
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

    test('no cap: the twenty-first page can be starred', () => {
      const store = new FavoritesStore(new FakeStorage());
      for (let i = 0; i < 25; i++) {
        expect(store.add({ path: `/v2/docs/pkg.Page${i}`, title: `Page ${i}` })).toBe(true);
      }
      expect(store.add(bucket)).toBe(true);
      expect(store.toggle(queue)).toEqual({ favorited: true, rejected: false });
      expect(store.list()).toHaveLength(27);
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
      expect(second.list()).toEqual([
        { ...bucket, group: 'Storage' },
        { ...queue, group: 'Application integration' },
      ]);
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
      expect(new FavoritesStore(storage).list()).toEqual([{ path: '/api/x', title: 'X' }]);
    });

    test('every stored entry loads, however many there are', () => {
      const storage = new FakeStorage();
      const oversized = Array.from({ length: 25 }, (_, i) => ({
        path: `/v2/docs/pkg.Page${i}`,
        title: `Page ${i}`,
      }));
      storage.setItem(STORAGE_KEY, JSON.stringify(oversized));
      expect(new FavoritesStore(storage).list()).toHaveLength(25);
    });

    test('reload picks up external storage changes (cross-tab sync)', () => {
      const storage = new FakeStorage();
      const store = new FavoritesStore(storage);
      storage.setItem(STORAGE_KEY, JSON.stringify([bucket]));
      expect(store.list()).toEqual([]);
      store.reload();
      expect(store.list()).toEqual([{ ...bucket, group: 'Storage' }]);
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

    test('search returns the first display results without loading candidates', async () => {
      const dataLoads = Array.from({ length: MAX_SEARCH_CANDIDATES + 5 }, () => 0);
      const results = dataLoads.map((_, index) => ({
        data: async () => {
          dataLoads[index] += 1;
          return { url: `/v2/docs/pkg.Page${index}.html` };
        },
      }));
      const handle = withFavoritesSearchBoost(
        { debouncedSearch: async () => ({ results }) },
        new FavoritesStore(new FakeStorage()),
      );

      const search = await handle.debouncedSearch!();

      expect(search?.results).toEqual(results.slice(0, MAX_SEARCH_RESULTS));
      expect(dataLoads.every((loads) => loads === 0)).toBe(true);
    });

    test('search can boost a favorite from the bounded candidate pool', async () => {
      const dataLoads = Array.from({ length: MAX_SEARCH_CANDIDATES + 5 }, () => 0);
      const results = dataLoads.map((_, index) => ({
        data: async () => {
          dataLoads[index] += 1;
          return { url: `/v2/docs/pkg.Page${index}.html` };
        },
      }));
      const store = new FavoritesStore(new FakeStorage());
      store.add({ path: '/v2/docs/pkg.Page40', title: 'Page 40' });
      const handle = withFavoritesSearchBoost(
        { debouncedSearch: async () => ({ results }) },
        store,
      );

      const search = await handle.debouncedSearch!();

      expect(search?.results).toHaveLength(MAX_SEARCH_RESULTS);
      expect(search?.results?.[0]).toBe(results[40]);
      expect(
        dataLoads.slice(0, MAX_SEARCH_CANDIDATES).every((loads) => loads === 1),
      ).toBe(true);
      expect(
        dataLoads.slice(MAX_SEARCH_CANDIDATES).every((loads) => loads === 0),
      ).toBe(true);
    });

    test('client module wraps the pagefind handle and exposes the shared store', () => {
      const source = readFileSync(resolve(THEME_DIR, 'favorites-client.ts'), 'utf-8');
      expect(source).toContain('__pagefind__');
      expect(source).toContain('debouncedSearch');
      expect(source).toContain('__cdkDocsFavorites');
      expect(source).toContain('rankFavoritesFirst');
    });
  });

  describe('theme wiring', () => {
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');

    test('star toggle renders through the doc-before layout slot', () => {
      expect(entry).toMatch(/"doc-before":[^\n]*h\(FavoriteStar\)/);
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

  describe('groups from the category map', () => {
    test('a page id drops the base, the extension and a readme suffix', () => {
      expect(pageId('/v2/docs/aws-cdk-lib.aws_sqs.Queue.html')).toBe(
        'aws-cdk-lib.aws_sqs.Queue',
      );
      expect(pageId('/v2/docs/aws-cdk-lib.aws_sqs-readme')).toBe('aws-cdk-lib.aws_sqs');
      expect(pageId('/v2/')).toBeUndefined();
    });

    test('a submodule page takes its submodule category', () => {
      expect(categoryFor('/v2/docs/aws-cdk-lib.aws_s3.Bucket')).toBe('Storage');
      expect(categoryFor('/v2/docs/aws-cdk-lib.aws_lambda.Function')).toBe('Compute');
      expect(categoryFor('/v2/docs/aws-cdk-lib.aws_sqs-readme')).toBe(
        'Application integration',
      );
    });

    test('a root type and the constructs library take the package category', () => {
      // The second part starts upper case, so it is a type name and the
      // package decides.
      expect(categoryFor('/v2/docs/aws-cdk-lib.Stack')).toBe('Framework');
      expect(categoryFor('/v2/docs/constructs.Construct')).toBe('Framework');
    });

    test('a scoped package reads its first underscore as the scope separator', () => {
      expect(categoryFor('/v2/docs/@aws-cdk_aws-amplify-alpha.App')).toBe(
        'Front-end and mobile',
      );
    });

    test('the five unmapped submodules have no category', () => {
      for (const submodule of [
        'aws_awsexternalanthropic',
        'aws_healthagent',
        'aws_rtbfabric',
        'aws_scn',
        'aws_uxc',
      ]) {
        expect(categoryFor(`/v2/docs/aws-cdk-lib.${submodule}.Thing`)).toBeUndefined();
      }
    });

    test('an unmapped page shows in Ungrouped and keeps no stored group', () => {
      const storage = new FakeStorage();
      const store = new FavoritesStore(storage);
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_scn.Thing', title: 'Thing' });
      expect(store.grouped()).toEqual([
        {
          name: UNGROUPED,
          entries: [{ path: '/v2/docs/aws-cdk-lib.aws_scn.Thing', title: 'Thing' }],
        },
      ]);
      // No `group` written, so a category added to the map later places it.
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual([
        { path: '/v2/docs/aws-cdk-lib.aws_scn.Thing', title: 'Thing' },
      ]);
    });

    test('a page the map gains a category for is placed on the next read', () => {
      const storage = new FakeStorage();
      // Stored with no group, as an unmapped page is.
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify([{ path: '/v2/docs/aws-cdk-lib.aws_s3.Bucket', title: 'Bucket' }]),
      );
      expect(new FavoritesStore(storage).grouped()[0].name).toBe('Storage');
    });

    test('groups sort A to Z with Ungrouped last, and rows A to Z inside', () => {
      const store = new FavoritesStore(new FakeStorage());
      store.add(queue);
      store.add(bucket);
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_sqs.QueuePolicy', title: 'QueuePolicy' });
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_scn.Thing', title: 'Thing' });
      expect(store.grouped().map((group) => [group.name, group.entries.map((e) => e.title)]))
        .toEqual([
          ['Application integration', ['Queue', 'QueuePolicy']],
          ['Storage', ['Bucket']],
          [UNGROUPED, ['Thing']],
        ]);
    });

    test('an entry stored without a group is placed and written back', () => {
      const storage = new FakeStorage();
      storage.setItem(STORAGE_KEY, JSON.stringify([{ path: bucket.path, title: 'Bucket' }]));
      const store = new FavoritesStore(storage);
      expect(store.grouped()[0].name).toBe('Storage');
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual([
        { path: bucket.path, title: 'Bucket', group: 'Storage' },
      ]);
    });

    test('a stored group wins over the map, including an explicit Ungrouped', () => {
      const storage = new FakeStorage();
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          { path: bucket.path, title: 'Bucket', group: 'Mine' },
          { path: queue.path, title: 'Queue', group: null },
        ]),
      );
      const store = new FavoritesStore(storage);
      expect(store.grouped().map((group) => group.name)).toEqual(['Mine', UNGROUPED]);
    });
  });

  describe('service name on a row', () => {
    const sections = [
      {
        items: [
          { text: 'aws-cdk-lib', modules: ['aws-cdk-lib', 'constructs'] },
          { text: 'aws-cdk-lib.triggers', modules: ['aws-cdk-lib.triggers'] },
        ],
      },
      {
        items: [
          { text: 'SQS', modules: ['aws-cdk-lib.aws_sqs', 'aws-cdk-lib.interfaces.aws_sqs'] },
          { text: 'S3', modules: ['aws-cdk-lib.aws_s3'] },
          { text: 'EKS (legacy)', modules: ['aws-cdk-lib.aws_eks'] },
          { text: 'EKS V2', modules: ['aws-cdk-lib.aws_eks_v2'] },
        ],
      },
    ];

    test('a page takes the name its Services entry shows', () => {
      expect(serviceNameFor(queue.path, sections)).toBe('SQS');
      expect(serviceNameFor(bucket.path, sections)).toBe('S3');
    });

    test('the two EKS modules keep their own names', () => {
      expect(serviceNameFor('/v2/docs/aws-cdk-lib.aws_eks.Cluster', sections)).toBe(
        'EKS (legacy)',
      );
      expect(serviceNameFor('/v2/docs/aws-cdk-lib.aws_eks_v2.Cluster', sections)).toBe(
        'EKS V2',
      );
    });

    test('the longest matching module stem wins, so a root type reads as its package', () => {
      // `aws-cdk-lib` owns every root type, but `aws-cdk-lib.aws_sqs` owns the
      // SQS pages, so a prefix match alone would label every page aws-cdk-lib.
      expect(serviceNameFor('/v2/docs/aws-cdk-lib.Stack', sections)).toBe('aws-cdk-lib');
      expect(serviceNameFor('/v2/docs/aws-cdk-lib.triggers.Trigger', sections)).toBe(
        'aws-cdk-lib.triggers',
      );
    });

    test('a page in neither list has no service', () => {
      expect(serviceNameFor('/v2/docs/pkg.Thing', sections)).toBeUndefined();
      expect(serviceNameFor('/v2/', sections)).toBeUndefined();
    });
  });

  describe('group editing', () => {
    function withTwo(): { store: FavoritesStore; storage: FakeStorage } {
      const storage = new FakeStorage();
      const store = new FavoritesStore(storage);
      store.add(bucket);
      store.add(queue);
      return { store, storage };
    }

    test('move puts a favorite in another group and the move is stored', () => {
      const { store, storage } = withTwo();
      expect(store.move(queue.path, 'Storage')).toBe(true);
      expect(store.grouped().map((group) => [group.name, group.entries.length])).toEqual([
        ['Storage', 2],
      ]);
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual([
        { path: bucket.path, title: 'Bucket', group: 'Storage' },
        { path: queue.path, title: 'Queue', group: 'Storage' },
      ]);
    });

    test('move to Ungrouped is stored as null, which the map does not override', () => {
      const { store, storage } = withTwo();
      store.move(queue.path, null);
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)[1]).toEqual({
        path: queue.path,
        title: 'Queue',
        group: null,
      });
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_sqs.QueuePolicy', title: 'QueuePolicy' });
      expect(store.grouped().map((group) => group.name)).toEqual([
        'Application integration',
        'Storage',
        UNGROUPED,
      ]);
    });

    test('a new group is kept while it is empty', () => {
      const { store, storage } = withTwo();
      expect(store.createGroup('  Mine  ')).toBe(true);
      expect(store.grouped().map((group) => group.name)).toEqual([
        'Application integration',
        'Mine',
        'Storage',
      ]);
      expect(JSON.parse(storage.getItem(GROUPS_STORAGE_KEY)!)).toEqual(['Mine']);
      expect(new FavoritesStore(storage).grouped().map((group) => group.name)).toContain(
        'Mine',
      );
    });

    test('a name that is empty, reserved, too long or taken is refused', () => {
      const { store } = withTwo();
      expect(store.checkGroupName('   ')).toBe('empty');
      expect(store.checkGroupName('ungrouped')).toBe('reserved');
      expect(store.checkGroupName('x'.repeat(41))).toBe('too-long');
      expect(store.checkGroupName('x'.repeat(40))).toBe('ok');
      expect(store.checkGroupName('storage')).toBe('duplicate');
      // Renaming a group to the name it already has is not a clash with itself.
      expect(store.checkGroupName('Storage', 'Storage')).toBe('ok');
      expect(store.createGroup('storage')).toBe(false);
    });

    test('renaming a map group carries its favorites and stores an alias', () => {
      const { store, storage } = withTwo();
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function' });
      expect(store.renameGroup('Compute', 'Servers')).toBeDefined();
      expect(store.grouped().map((group) => group.name)).toEqual([
        'Application integration',
        'Servers',
        'Storage',
      ]);
      expect(JSON.parse(storage.getItem(ALIASES_STORAGE_KEY)!)).toEqual({
        Compute: 'Servers',
      });

      // A Compute page favorited later joins the reader's name, also after a reload.
      const reloaded = new FavoritesStore(storage);
      reloaded.add({ path: '/v2/docs/aws-cdk-lib.aws_ec2.Instance', title: 'Instance' });
      expect(
        reloaded.grouped().find((group) => group.name === 'Servers')?.entries.map((e) => e.title),
      ).toEqual(['Function', 'Instance']);
    });

    test('renaming again moves the alias, and renaming back drops it', () => {
      const { store, storage } = withTwo();
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function' });
      store.renameGroup('Compute', 'Servers');
      store.renameGroup('Servers', 'Hosts');
      expect(JSON.parse(storage.getItem(ALIASES_STORAGE_KEY)!)).toEqual({ Compute: 'Hosts' });
      store.renameGroup('Hosts', 'Compute');
      expect(JSON.parse(storage.getItem(ALIASES_STORAGE_KEY)!)).toEqual({});
    });

    test('renaming a group the reader made stores no alias', () => {
      const { store, storage } = withTwo();
      store.createGroup('Mine');
      store.move(queue.path, 'Mine');
      store.renameGroup('Mine', 'Ours');
      expect(JSON.parse(storage.getItem(ALIASES_STORAGE_KEY)!)).toEqual({});
      expect(store.grouped().map((group) => group.name)).toEqual(['Ours', 'Storage']);
    });

    test('deleting a group moves its favorites to Ungrouped and drops its alias', () => {
      const { store, storage } = withTwo();
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function' });
      store.renameGroup('Compute', 'Servers');
      expect(store.countIn('Servers')).toBe(1);
      expect(store.deleteGroup('Servers')).toBeDefined();
      expect(store.grouped().map((group) => group.name)).toEqual([
        'Application integration',
        'Storage',
        UNGROUPED,
      ]);
      expect(JSON.parse(storage.getItem(ALIASES_STORAGE_KEY)!)).toEqual({});

      // The next Compute page creates the map's own group again.
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_ec2.Instance', title: 'Instance' });
      expect(store.grouped().map((group) => group.name)).toContain('Compute');
    });

    test('Ungrouped cannot be renamed or deleted', () => {
      const { store } = withTwo();
      store.move(queue.path, null);
      expect(store.deleteGroup(UNGROUPED)).toBeUndefined();
      expect(store.renameGroup(UNGROUPED, 'Rest')).toBeUndefined();
    });

    test('undo of a delete restores the favorites, the group and the alias', () => {
      const { store, storage } = withTwo();
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function' });
      store.renameGroup('Compute', 'Servers');
      const undo = store.deleteGroup('Servers')!;
      store.restore(undo);
      expect(
        store.grouped().find((group) => group.name === 'Servers')?.entries.map((e) => e.title),
      ).toEqual(['Function']);
      expect(JSON.parse(storage.getItem(ALIASES_STORAGE_KEY)!)).toEqual({
        Compute: 'Servers',
      });
    });

    test('undo of a removal puts the favorite back in the group it was in', () => {
      const { store } = withTwo();
      store.move(queue.path, 'Storage');
      const undo = store.snapshot();
      store.remove(queue.path);
      expect(store.list()).toHaveLength(1);
      store.restore(undo);
      expect(
        store.grouped().find((group) => group.name === 'Storage')?.entries.map((e) => e.title),
      ).toEqual(['Bucket', 'Queue']);
    });

    test('the revision counts favorite changes, so an Undo offer can tell one happened', () => {
      const { store } = withTwo();
      const start = store.revision();
      store.move(queue.path, 'Storage');
      expect(store.revision()).toBeGreaterThan(start);
      const afterMove = store.revision();
      // Folding changes no favorite, so an Undo offer survives it.
      store.setGroupCollapsed('Storage', true);
      expect(store.revision()).toBe(afterMove);
      store.remove(queue.path);
      expect(store.revision()).toBeGreaterThan(afterMove);
    });

    test('folding is saved per group name and defaults to open', () => {
      const { store, storage } = withTwo();
      expect(store.isGroupCollapsed('Storage')).toBe(false);
      store.setGroupCollapsed('Storage', true);
      expect(JSON.parse(storage.getItem(COLLAPSED_GROUPS_STORAGE_KEY)!)).toEqual(['Storage']);
      expect(new FavoritesStore(storage).isGroupCollapsed('Storage')).toBe(true);
      store.setGroupCollapsed('Storage', false);
      expect(JSON.parse(storage.getItem(COLLAPSED_GROUPS_STORAGE_KEY)!)).toEqual([]);
    });

    test('malformed group, alias and collapsed storage reads as empty', () => {
      const storage = new FakeStorage();
      storage.setItem(GROUPS_STORAGE_KEY, '{"not":"an array"}');
      storage.setItem(ALIASES_STORAGE_KEY, '["not an object"]');
      storage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, 'nonsense');
      const store = new FavoritesStore(storage);
      store.add(bucket);
      expect(store.grouped().map((group) => group.name)).toEqual(['Storage']);
      expect(store.isGroupCollapsed('Storage')).toBe(false);
    });

    test('an alias whose value is not a usable string is dropped on read', () => {
      const storage = new FakeStorage();
      storage.setItem(
        ALIASES_STORAGE_KEY,
        JSON.stringify({ Compute: 7, Storage: '  ', Databases: 'Data' }),
      );
      const store = new FavoritesStore(storage);
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function' });
      store.add(bucket);
      store.add({ path: '/v2/docs/aws-cdk-lib.aws_dynamodb.Table', title: 'Table' });
      expect(store.grouped().map((group) => group.name)).toEqual([
        'Compute',
        'Data',
        'Storage',
      ]);
    });
  });

  describe('the category map covers the documented modules', () => {
    // `docgen.baseline.json` is the committed record of what docgen documents,
    // so a module added to the library shows up here rather than silently
    // falling into Ungrouped.
    const baseline = JSON.parse(
      readFileSync(resolve(ROOT, 'docgen.baseline.json'), 'utf-8'),
    ) as { readmes: Record<string, unknown> };
    const map = JSON.parse(
      readFileSync(resolve(THEME_DIR, 'favorite-categories.json'), 'utf-8'),
    ) as { categories: string[]; map: Record<string, string> };

    /**
     * Module ids with no category, which land in Ungrouped. Every one of them
     * has to be listed here, so a new module cannot slip in unnoticed: a
     * failure here means deciding its category, not extending this list on
     * sight.
     */
    const UNMAPPED = [
      '@aws-cdk/metrics-facade-alpha',
      'aws-cdk-lib.amzn_sdc',
      'aws-cdk-lib.assets',
      'aws-cdk-lib.aws_artifact',
      'aws-cdk-lib.aws_awsexternalanthropic',
      'aws-cdk-lib.aws_backupsearch',
      'aws-cdk-lib.aws_codetest',
      'aws-cdk-lib.aws_cognitosync',
      'aws-cdk-lib.aws_controlcatalog',
      'aws-cdk-lib.aws_healthagent',
      'aws-cdk-lib.aws_iot1click',
      'aws-cdk-lib.aws_licensemanagerusersubscriptions',
      'aws-cdk-lib.aws_polly',
      'aws-cdk-lib.aws_rtbfabric',
      'aws-cdk-lib.aws_scn',
      'aws-cdk-lib.aws_states',
      'aws-cdk-lib.aws_thinclient',
      'aws-cdk-lib.aws_usernotifications',
      'aws-cdk-lib.aws_uxc',
      'aws-cdk-lib.interfaces',
      'aws-cdk-lib.lambda_layer_kubectl',
    ];

    test('every documented module reaches a category through the real lookup', () => {
      // Through `categoryFor`, not the map keys: a key the lookup can never
      // build (a three-part id) or a break in the scoped `_` rewrite would
      // both pass a direct key check while the site sent those pages to
      // Ungrouped. `@aws-cdk/x` is the page id `@aws-cdk_x`.
      const uncovered = Object.keys(baseline.readmes).filter(
        (id) =>
          !categoryFor(`/v2/docs/${id.replace('/', '_')}`) && !UNMAPPED.includes(id),
      );
      expect(uncovered).toEqual([]);
    });

    test('the unmapped list names only ids the lookup really cannot place', () => {
      const placed = UNMAPPED.filter((id) =>
        categoryFor(`/v2/docs/${id.replace('/', '_')}`),
      );
      expect(placed).toEqual([]);
    });

    test('every mapped value is one of the category names', () => {
      const unknown = Object.entries(map.map)
        .filter(([, category]) => !map.categories.includes(category))
        .map(([id]) => id);
      expect(unknown).toEqual([]);
    });

    test('the category names are A to Z, which is the order the view shows', () => {
      expect(map.categories).toEqual(
        [...map.categories].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
      );
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
        { path: bucket.path, title: bucket.title, group: 'Storage' },
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
