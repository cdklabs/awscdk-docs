import { readFileSync } from 'fs';
import { join } from 'path';
import { groupKey, groupKeys, type ApiSidebarNode } from '../docs/.vitepress/theme/api-sidebar.js';
import {
  createCollapseMemory,
  DEFAULT_CAP,
  effectiveExpanded,
  EXPANDED_STORE_KEY,
  type StorageLike,
} from '../docs/.vitepress/theme/sidebar-collapse.js';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const THEME = join(import.meta.dirname, '..', 'docs', '.vitepress', 'theme');
const sidebarSource = readFileSync(join(THEME, 'ApiSidebar.vue'), 'utf-8');

describe('createCollapseMemory', () => {
  test('records an explicit open and an explicit close as distinct from untouched', () => {
    const memory = createCollapseMemory(fakeStorage());
    memory.set('Framework', false);
    memory.set('Services|aws-s3', true);
    expect(memory.get('Framework')).toBe(false);
    expect(memory.get('Services|aws-s3')).toBe(true);
    expect(memory.get('Services|aws-sqs')).toBeUndefined();
  });

  test('survives a reload: a fresh instance over the same storage sees the choices', () => {
    const storage = fakeStorage();
    createCollapseMemory(storage).set('Framework', false);
    expect(createCollapseMemory(storage).get('Framework')).toBe(false);
  });

  test('two tabs open at once do not clobber each other (both choices survive)', () => {
    // Both instances are constructed BEFORE either writes, which is what a
    // reader with two tabs already open has. An instance that serialized its
    // construction-time snapshot would drop the other tab's choice.
    const storage = fakeStorage();
    const tabA = createCollapseMemory(storage);
    const tabB = createCollapseMemory(storage);

    tabA.set('Framework', false);
    tabB.set('Services|aws-s3', true);

    expect(createCollapseMemory(storage).get('Framework')).toBe(false);
    expect(createCollapseMemory(storage).get('Services|aws-s3')).toBe(true);
    // And each live instance sees the other's write, not just a fresh reload.
    expect(tabA.get('Services|aws-s3')).toBe(true);
    expect(tabB.get('Framework')).toBe(false);
  });

  test('a concurrent tab pruning a dead key does not resurrect it from a stale snapshot', () => {
    const storage = fakeStorage();
    const tabA = createCollapseMemory(storage);
    const tabB = createCollapseMemory(storage);
    tabA.set('Services|aws-gone', true);
    tabA.set('Framework', false);

    tabB.prune(new Set(['Framework']));

    tabA.set('Services|aws-s3', true);
    expect(createCollapseMemory(storage).get('Services|aws-gone')).toBeUndefined();
    expect(createCollapseMemory(storage).get('Framework')).toBe(false);
  });

  test('persists under the versioned key', () => {
    const storage = fakeStorage();
    createCollapseMemory(storage).set('Framework', true);
    expect(storage.data.has(EXPANDED_STORE_KEY)).toBe(true);
    expect(EXPANDED_STORE_KEY).toMatch(/:v\d+$/);
  });

  test('re-toggling a key overwrites rather than appends', () => {
    const memory = createCollapseMemory(fakeStorage());
    memory.set('Framework', true);
    memory.set('Framework', false);
    expect(memory.entries()).toEqual([['Framework', false]]);
  });

  test('corrupt stored data falls back to no choices instead of throwing', () => {
    for (const raw of ['not json', '{"a":1}', '[["k"]]', '[[1,true]]', '[["k","open"]]']) {
      const memory = createCollapseMemory(fakeStorage({ [EXPANDED_STORE_KEY]: raw }));
      expect(memory.entries()).toEqual([]);
      expect(memory.get('k')).toBeUndefined();
    }
  });

  test('a throwing storage degrades to in-memory rather than propagating', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const memory = createCollapseMemory(hostile);
    expect(() => memory.set('Framework', true)).not.toThrow();
    expect(memory.get('Framework')).toBe(true);
  });

  test('works with no storage at all (SSR)', () => {
    const memory = createCollapseMemory(undefined);
    memory.set('Framework', true);
    expect(memory.get('Framework')).toBe(true);
  });

  test('the stored set is capped, evicting the least recently set key', () => {
    const memory = createCollapseMemory(fakeStorage(), EXPANDED_STORE_KEY, 3);
    for (const key of ['a', 'b', 'c', 'd']) memory.set(key, true);
    expect(memory.entries().map(([k]) => k)).toEqual(['b', 'c', 'd']);
    expect(DEFAULT_CAP).toBeGreaterThan(0);
  });

  test('an oversized stored payload is trimmed on read', () => {
    const oversized = JSON.stringify([...Array(10).keys()].map((i) => [`k${i}`, true]));
    const memory = createCollapseMemory(fakeStorage({ [EXPANDED_STORE_KEY]: oversized }), EXPANDED_STORE_KEY, 4);
    expect(memory.entries()).toHaveLength(4);
  });

  test('prune forgets keys absent from the current tree and keeps the rest', () => {
    const storage = fakeStorage();
    const memory = createCollapseMemory(storage);
    memory.set('Framework', false);
    memory.set('Services|aws-gone', true);
    memory.prune(new Set(['Framework', 'Services']));
    expect(memory.get('Framework')).toBe(false);
    expect(memory.get('Services|aws-gone')).toBeUndefined();
    // Pruning is written through, so the dead key does not come back.
    expect(createCollapseMemory(storage).get('Services|aws-gone')).toBeUndefined();
  });
});

describe('effectiveExpanded', () => {
  test('an untouched default stays open', () => {
    expect([...effectiveExpanded(['Framework'], [])]).toEqual(['Framework']);
  });

  test('an explicitly closed default is closed: a collapse must stick', () => {
    expect([...effectiveExpanded(['Framework', 'Services'], [['Framework', false]])]).toEqual([
      'Services',
    ]);
  });

  test('an explicitly opened non-default is open', () => {
    const open = effectiveExpanded(['Framework'], [['Services|aws-s3', true]]);
    expect(open.has('Services|aws-s3')).toBe(true);
    expect(open.has('Framework')).toBe(true);
  });
});

describe('groupKeys', () => {
  const tree: ApiSidebarNode[] = [
    {
      text: 'Framework',
      collapsed: false,
      items: [{ text: 'aws-cdk-lib', items: [{ text: 'Bucket', link: '/api/x' }] }],
    },
    { text: 'Services', items: [{ text: 'aws-s3', items: [] }] },
    { text: 'Loose leaf', link: '/api/y' },
  ];

  test('collects every group key, nested, and no leaves', () => {
    expect([...groupKeys(tree)].sort()).toEqual(
      ['Framework', groupKey('Framework', 'aws-cdk-lib'), 'Services'].sort(),
    );
  });

  test('an empty tree yields no keys', () => {
    expect(groupKeys([]).size).toBe(0);
  });
});

describe('ApiSidebar wiring', () => {
  test('creates the disclosure memory over localStorage, SSR-guarded', () => {
    expect(sidebarSource).toMatch(/createCollapseMemory\(/);
    expect(sidebarSource).toMatch(/typeof window !== "undefined" \? window\.localStorage : undefined/);
  });

  test('explicit toggles are persisted', () => {
    const toggleBody = /function toggle\(key: string\) \{[\s\S]*?\n\}/.exec(sidebarSource)?.[0] ?? '';
    // `collapseMemory` resolves to the active navigation style's store.
    expect(toggleBody).toMatch(/collapseMemory\.value\.set\(/);
  });

  test('the auto-reveal path never writes to the store', () => {
    const syncBody = /function syncActive\(\) \{[\s\S]*?\n\}/.exec(sidebarSource)?.[0] ?? '';
    expect(syncBody).not.toMatch(/collapseMemory\.set\(/);
    expect(syncBody).toMatch(/expanded\.value/);
  });

  test('stored choices are layered over the generated defaults and pruned to the tree', () => {
    expect(sidebarSource).toMatch(/effectiveExpanded\(/);
    // Pruning is scoped to loaded sections: a store pruned against the bare
    // group keys of a skeleton would forget every choice inside a section
    // still in its chunk file. The package style has no unloaded sections
    // (its only collapsible groups are the top-level entries the skeleton
    // already names), so its store prunes against the whole tree.
    const initBody = /function initStyle\(style: NavStyle\) \{[\s\S]*?\n\}/.exec(sidebarSource)?.[0] ?? '';
    expect(initBody).toMatch(/style === "package"\s*\?\s*groupKeys\(styleTree\)\s*:\s*retainedGroupKeys\(styleTree/);
    expect(initBody).toMatch(/memory\.prune\(live\)/);
    // Each style prunes only its own store, never the other's.
    expect(initBody).toMatch(/const memory = collapseMemories\[style\]/);
  });

  test('the filter force-open path still does not touch the persisted set', () => {
    const filterRegion = sidebarSource.slice(sidebarSource.indexOf('const filterTerms'));
    const displayRegion = filterRegion.slice(0, filterRegion.indexOf('function syncActive'));
    expect(displayRegion).not.toMatch(/collapseMemory/);
  });

  test('sidebar scroll memory is still sessionStorage, one store per navigation style', () => {
    expect(sidebarSource).toMatch(/const sessionStore = typeof window !== "undefined" \? window\.sessionStorage : undefined/);
    expect(sidebarSource).toMatch(/createScrollMemory\(sessionStore, styleStorageKey\(SCROLL_STORE_KEY, "service"\)\)/);
    expect(sidebarSource).toMatch(/createScrollMemory\(sessionStore, styleStorageKey\(SCROLL_STORE_KEY, "package"\)\)/);
  });
});
