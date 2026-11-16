import {
  HotkeyEvent,
  isEditableTarget,
  isSearchHotkey,
  SEARCH_KEYSHORTCUTS,
} from '../docs/.vitepress/theme/search-hotkeys.js';

function keydown(overrides: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return {
    key: '/',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: { tagName: 'BODY' },
    ...overrides,
  };
}

describe('search hotkeys', () => {
  test('announces every opening shortcut in aria-keyshortcuts grammar', () => {
    expect(SEARCH_KEYSHORTCUTS).toBe('/ Control+K Meta+K');
  });

  test('a plain slash outside editable elements opens search', () => {
    expect(isSearchHotkey(keydown(), false)).toBe(true);
    expect(isSearchHotkey(keydown({ target: { tagName: 'A' } }), false)).toBe(true);
  });

  test('other keys never open search', () => {
    expect(isSearchHotkey(keydown({ key: '?' }), false)).toBe(false);
    expect(isSearchHotkey(keydown({ key: 'k' }), false)).toBe(false);
  });

  test('a held modifier keeps the slash a character', () => {
    expect(isSearchHotkey(keydown({ ctrlKey: true }), false)).toBe(false);
    expect(isSearchHotkey(keydown({ metaKey: true }), false)).toBe(false);
    expect(isSearchHotkey(keydown({ altKey: true }), false)).toBe(false);
  });

  test('AltGr, reported as Ctrl+Alt on Windows, still types the shortcut', () => {
    const altGraph = (key: string) => key === 'AltGraph';
    expect(isSearchHotkey(keydown({ ctrlKey: true, altKey: true, getModifierState: altGraph }), false)).toBe(true);
    expect(isSearchHotkey(keydown({ ctrlKey: true, altKey: true, getModifierState: () => false }), false)).toBe(false);
    expect(isSearchHotkey(keydown({ metaKey: true, getModifierState: altGraph }), false)).toBe(false);
  });

  test('focus in an editable element keeps the slash a character', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isEditableTarget({ tagName })).toBe(true);
      expect(isSearchHotkey(keydown({ target: { tagName } }), false)).toBe(false);
    }
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  test('an open dialog, a handled event or IME composition leave the key alone', () => {
    expect(isSearchHotkey(keydown(), true)).toBe(false);
    expect(isSearchHotkey(keydown({ defaultPrevented: true }), false)).toBe(false);
    expect(isSearchHotkey(keydown({ isComposing: true }), false)).toBe(false);
  });
});
