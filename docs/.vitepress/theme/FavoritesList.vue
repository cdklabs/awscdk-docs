<!--
  "Favorites" quick-access section rendered at the top of the sidebar via the
  default theme's `sidebar-nav-before` layout slot. Populated in onMounted to
  avoid hydration mismatches on a statically generated site.

  Collapsible and collapsed by default: the section sits above the primary
  FRAMEWORK/SERVICES tree, so an always-open list would push the tree down. The
  header is a real disclosure button with the same aria contract and caret as the
  nav tree's own groups; the count stays visible while collapsed for
  discoverability.

  With the Explorer preview on, the section moves out of the API view and becomes
  the Favorites view: a grouped list, one group per AWS service category, which
  the reader can regroup, rename and fold. Each row names its page's service, so
  two favorites with the same name tell apart. Removals and group deletions are
  undoable from a toast. The preview-off sidebar keeps the flat list and its own
  stored collapsed state.
-->
<script setup lang="ts">
import { useData, useRoute, withBase } from "vitepress";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { API_ROOT } from "../../../src/site-routes";
import { apiSidebarAsset, loadApiSidebar, type ApiSidebarNode } from "./api-sidebar";
import { explorerPreview, explorerView } from "./explorer-preview";
import {
  favoritesStore,
  pageId,
  readCollapsed,
  serviceNameFor,
  UNGROUPED,
  writeCollapsed,
  type FavoriteEntry,
  type FavoriteGroup,
  type FavoritesUndo,
} from "./favorites";
import { pageHref } from "./page-href";

/** How long an Undo offer stays, in milliseconds. */
const TOAST_MS = 8000;

/** Which menu is open: a row's (by page path) or a group heading's (by name). */
interface OpenMenu {
  kind: "row" | "group";
  key: string;
  /** `groups` is the "Move to group" level of a row menu. */
  level: "menu" | "groups";
}

/** An inline name field: a new group, or a rename of one. */
interface NameField {
  mode: "create" | "rename";
  /** The group being renamed, or the favorite a new group is being made for. */
  target?: string;
  value: string;
  error: string;
}

const route = useRoute();
const { theme } = useData();

const entries = ref<readonly FavoriteEntry[]>([]);
const groups = ref<FavoriteGroup[]>([]);
// Collapsed until storage says otherwise, and read in onMounted with the
// entries: reading it during setup would run on the server too, where
// there is no localStorage, and a first paint that disagreed with the
// stored choice would flicker.
const collapsed = ref(true);
// Gated on mount, like the entries, so a stored preview choice never disagrees with the server render.
const mounted = ref(false);
const openMenu = ref<OpenMenu | null>(null);
const nameField = ref<NameField | null>(null);
const toast = ref<{ text: string; undo: FavoritesUndo; focus: string } | null>(null);
const announcement = ref("");
/** Service name per page path, from the Explorer's own Framework and Services lists. */
const services = ref<Record<string, string>>({});

const viewMode = computed(
  () => mounted.value && explorerPreview.value === "on" && route.path.includes(API_ROOT),
);
const viewShown = computed(() => viewMode.value && explorerView.value === "favorites");
const visible = computed(() =>
  viewMode.value
    ? viewShown.value
    : route.path.includes(API_ROOT) && entries.value.length > 0,
);

let unsubscribe: (() => void) | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastLeft = TOAST_MS;

function refresh(): void {
  entries.value = favoritesStore().list();
  groups.value = favoritesStore().grouped();
}

onMounted(() => {
  mounted.value = true;
  refresh();
  collapsed.value = readCollapsed(
    typeof localStorage === "undefined" ? undefined : localStorage,
  );
  unsubscribe = favoritesStore().subscribe(refresh);
  loadServices();
});
onUnmounted(() => {
  unsubscribe?.();
  clearToastTimer();
});

/** The skeleton's sections once fetched, so a page starred later still gets its service name. */
let sectionsLoaded: ApiSidebarNode[] | undefined;

/**
 * The service names, read from the generated sidebar skeleton the Explorer
 * already fetches. `loadApiSidebar` memoizes by key, so the view costs no
 * extra request when the API tree has loaded the same asset.
 */
function loadServices(): void {
  const asset = apiSidebarAsset(theme.value.apiSidebarAsset ?? "");
  if (!asset) {
    return;
  }
  loadApiSidebar(withBase(asset), "skeleton")
    .then((sections: ApiSidebarNode[]) => {
      const next: Record<string, string> = {};
      for (const entry of favoritesStore().list()) {
        const name = serviceNameFor(entry.path, sections);
        if (name) {
          next[entry.path] = name;
        }
      }
      services.value = next;
      sectionsLoaded = sections;
    })
    .catch(() => {
      // No service names this session; the rows still carry their titles.
    });
}

function serviceOf(entry: FavoriteEntry): string | undefined {
  const known = services.value[entry.path];
  if (known) {
    return known;
  }
  // A page starred after the skeleton arrived.
  return sectionsLoaded ? serviceNameFor(entry.path, sectionsLoaded) : undefined;
}

function linkFor(entry: FavoriteEntry): string {
  return pageHref(entry.path);
}

function unstar(entry: FavoriteEntry): void {
  favoritesStore().remove(entry.path);
}

function toggle(): void {
  collapsed.value = !collapsed.value;
  writeCollapsed(
    collapsed.value,
    typeof localStorage === "undefined" ? undefined : localStorage,
  );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function isCollapsed(name: string): boolean {
  return favoritesStore().isGroupCollapsed(name);
}

function toggleGroup(name: string): void {
  favoritesStore().setGroupCollapsed(name, !isCollapsed(name));
}

function groupTargets(): string[] {
  return favoritesStore().groupNames();
}

function groupOf(entry: FavoriteEntry): string {
  return favoritesStore().groupOf(entry);
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function menuOpen(kind: OpenMenu["kind"], key: string): boolean {
  return openMenu.value?.kind === kind && openMenu.value.key === key;
}

function openFor(kind: OpenMenu["kind"], key: string): void {
  openMenu.value = { kind, key, level: "menu" };
  focusFirstItem();
}

function closeMenu(focusKey?: string): void {
  openMenu.value = null;
  if (focusKey) {
    focus(`[data-fav-actions="${cssEscape(focusKey)}"]`);
  }
}

function toggleFor(kind: OpenMenu["kind"], key: string): void {
  if (menuOpen(kind, key)) {
    closeMenu(key);
  } else {
    openFor(kind, key);
  }
}

function showGroupLevel(): void {
  if (openMenu.value) {
    openMenu.value = { ...openMenu.value, level: "groups" };
    focusFirstItem();
  }
}

function showMenuLevel(): void {
  if (openMenu.value) {
    openMenu.value = { ...openMenu.value, level: "menu" };
    focusFirstItem();
  }
}

/** Arrow, Home, End and Escape inside an open menu. */
function onMenuKey(event: KeyboardEvent, key: string): void {
  const items = menuItems(event.currentTarget as HTMLElement);
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = (index + step + items.length) % items.length;
    items[next]?.focus();
  } else if (event.key === "Home") {
    event.preventDefault();
    items[0]?.focus();
  } else if (event.key === "End") {
    event.preventDefault();
    items[items.length - 1]?.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (openMenu.value?.level === "groups") {
      showMenuLevel();
    } else {
      closeMenu(key);
    }
  } else if (event.key === "ArrowLeft" && openMenu.value?.level === "groups") {
    event.preventDefault();
    showMenuLevel();
  } else if (event.key === "Tab") {
    openMenu.value = null;
  }
}

function menuItems(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
}

function focusFirstItem(): void {
  void nextTick(() => {
    const panel = document.querySelector<HTMLElement>(".favorites-menu");
    if (panel) {
      menuItems(panel)[0]?.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function removeEntry(entry: FavoriteEntry): void {
  const group = groupOf(entry);
  const neighbor = neighborOf(entry, group);
  const undo = favoritesStore().snapshot();
  closeMenu();
  favoritesStore().remove(entry.path);
  showToast(`Removed “${entry.title}” from Favorites.`, undo, entry.path);
  focusAfter(neighbor, group);
}

/** The row link focus should land on after `entry` goes: the next row, else the previous. */
function neighborOf(entry: FavoriteEntry, group: string): string | undefined {
  const rows = groups.value.find((g) => g.name === group)?.entries ?? [];
  const index = rows.findIndex((e) => e.path === entry.path);
  return rows[index + 1]?.path ?? rows[index - 1]?.path;
}

function focusAfter(path: string | undefined, group: string): void {
  void nextTick(() => {
    if (path && focus(`[data-fav-link="${cssEscape(path)}"]`)) {
      return;
    }
    if (focus(`[data-fav-group="${cssEscape(group)}"]`)) {
      return;
    }
    focus(".favorites-empty");
  });
}

function moveEntry(entry: FavoriteEntry, group: string | null): void {
  closeMenu();
  favoritesStore().move(entry.path, group);
  announcement.value = `Moved ${entry.title} to ${group ?? UNGROUPED}.`;
  void nextTick(() => focus(`[data-fav-link="${cssEscape(entry.path)}"]`));
}

function startCreate(target?: string): void {
  closeMenu();
  nameField.value = { mode: "create", target, value: "", error: "" };
  focusField();
}

function startRename(name: string): void {
  closeMenu();
  nameField.value = { mode: "rename", target: name, value: name, error: "" };
  focusField();
}

function focusField(): void {
  void nextTick(() => {
    const field = document.querySelector<HTMLInputElement>(".favorites-name-input");
    field?.focus();
    field?.select();
  });
}

function submitName(): void {
  const field = nameField.value;
  if (!field) {
    return;
  }
  const name = field.value.trim();
  if (name === "") {
    cancelName();
    return;
  }
  const store = favoritesStore();
  const check = store.checkGroupName(
    name,
    field.mode === "rename" ? field.target : undefined,
  );
  if (check === "duplicate") {
    field.error = `A group named “${name}” already exists.`;
    return;
  }
  if (check !== "ok") {
    field.error =
      check === "reserved"
        ? `“${UNGROUPED}” is reserved.`
        : "A group name is 1 to 40 characters.";
    return;
  }
  if (field.mode === "rename" && field.target) {
    store.renameGroup(field.target, name);
  } else {
    store.createGroup(name);
    if (field.target) {
      store.move(field.target, name);
    }
  }
  nameField.value = null;
  void nextTick(() => focus(`[data-fav-group="${cssEscape(name)}"]`));
}

function cancelName(): void {
  const field = nameField.value;
  nameField.value = null;
  void nextTick(() => {
    if (field?.mode === "rename" && field.target) {
      focus(`[data-fav-group="${cssEscape(field.target)}"]`);
    } else {
      focus(".favorites-new-group");
    }
  });
}

function removeGroup(name: string): void {
  const count = favoritesStore().countIn(name);
  closeMenu();
  const undo = favoritesStore().deleteGroup(name);
  if (!undo) {
    return;
  }
  const moved =
    count === 0
      ? ""
      : ` ${count} favorite${count === 1 ? "" : "s"} moved to ${UNGROUPED}.`;
  showToast(`Deleted group “${name}”.${moved}`, undo, name);
  void nextTick(() => focus(`[data-fav-group="${cssEscape(UNGROUPED)}"]`));
}

// ---------------------------------------------------------------------------
// Undo toast
// ---------------------------------------------------------------------------

function showToast(text: string, undo: FavoritesUndo, focusKey: string): void {
  toast.value = { text, undo, focus: focusKey };
  toastLeft = TOAST_MS;
  startToastTimer();
}

let toastStarted = 0;

function startToastTimer(): void {
  clearToastTimer();
  const started = Date.now();
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, toastLeft);
  toastStarted = started;
}

/** The timer pauses while the pointer is over the toast or focus is inside it. */
function pauseToast(): void {
  if (toastTimer === undefined) {
    return;
  }
  toastLeft = Math.max(0, toastLeft - (Date.now() - toastStarted));
  clearToastTimer();
}

function resumeToast(): void {
  if (toast.value && toastTimer === undefined) {
    startToastTimer();
  }
}

function clearToastTimer(): void {
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer);
    toastTimer = undefined;
  }
}

function undoLast(): void {
  const current = toast.value;
  if (!current) {
    return;
  }
  favoritesStore().restore(current.undo);
  toast.value = null;
  clearToastTimer();
  void nextTick(() => {
    if (!focus(`[data-fav-link="${cssEscape(current.focus)}"]`)) {
      focus(`[data-fav-group="${cssEscape(current.focus)}"]`);
    }
  });
}

/** Delete removes the focused favorite; Ctrl+Z (Cmd+Z) takes the Undo the toast offers. */
function onViewKey(event: KeyboardEvent, entry?: FavoriteEntry): void {
  if ((event.key === "z" || event.key === "Z") && (event.ctrlKey || event.metaKey)) {
    if (toast.value) {
      event.preventDefault();
      undoLast();
    }
    return;
  }
  if (entry && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    removeEntry(entry);
  }
}

// ---------------------------------------------------------------------------
// Focus helpers
// ---------------------------------------------------------------------------

function focus(selector: string): boolean {
  const target = document.querySelector<HTMLElement>(`.favorites-section ${selector}`);
  target?.focus();
  return target !== null;
}

/** `CSS.escape` is not in jsdom or in every target browser, so quote the few characters a path or name can carry. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
</script>

<template>
  <nav
    v-if="visible"
    class="favorites-section"
    :class="{ 'favorites-grouped': viewShown }"
    aria-label="Favorites"
    @keydown="onViewKey($event)"
  >
    <template v-if="viewShown">
      <div class="favorites-view-head">
        <h2 class="favorites-static-heading">
          <span aria-hidden="true">★ </span>Favorites ({{ entries.length }})
        </h2>
        <button
          v-if="entries.length > 0"
          type="button"
          class="favorites-new-group"
          @click="startCreate()"
        >
          <span class="favorites-plus" aria-hidden="true">+</span>New group
        </button>
      </div>
      <p v-if="entries.length === 0" class="favorites-empty" tabindex="-1">
        <strong>No favorites yet.</strong><br />
        Select the star (☆) on an API page to add it. Favorites sort into groups,
        such as Storage or Compute, and stay in this browser.
      </p>
      <template v-else>
        <div v-if="nameField && nameField.mode === 'create'" class="favorites-name-field">
          <input
            class="favorites-name-input"
            type="text"
            aria-label="New group name"
            placeholder="Group name"
            maxlength="40"
            :value="nameField.value"
            @input="nameField.value = ($event.target as HTMLInputElement).value"
            @keydown.enter.prevent="submitName"
            @keydown.esc.prevent="cancelName"
          />
          <p v-if="nameField.error" class="favorites-name-error">{{ nameField.error }}</p>
        </div>
        <div v-for="group in groups" :key="group.name" class="favorites-group">
          <div class="favorites-group-head">
            <template v-if="nameField && nameField.mode === 'rename' && nameField.target === group.name">
              <input
                class="favorites-name-input"
                type="text"
                aria-label="Group name"
                maxlength="40"
                :value="nameField.value"
                @input="nameField.value = ($event.target as HTMLInputElement).value"
                @keydown.enter.prevent="submitName"
                @keydown.esc.prevent="cancelName"
              />
              <p v-if="nameField.error" class="favorites-name-error">{{ nameField.error }}</p>
            </template>
            <template v-else>
              <button
                type="button"
                class="favorites-group-toggle"
                :data-fav-group="group.name"
                :aria-expanded="!isCollapsed(group.name)"
                @click="toggleGroup(group.name)"
              >
                <span
                  class="favorites-caret"
                  :class="{ open: !isCollapsed(group.name) }"
                  aria-hidden="true"
                  >›</span
                >
                <span class="favorites-group-name">{{ group.name }}</span>
                <span class="favorites-group-count">({{ group.entries.length }})</span>
              </button>
              <button
                v-if="group.name !== UNGROUPED"
                type="button"
                class="favorites-actions"
                :data-fav-actions="group.name"
                :aria-label="`Actions for group ${group.name}`"
                aria-haspopup="menu"
                :aria-expanded="menuOpen('group', group.name)"
                @click="toggleFor('group', group.name)"
                @keydown.down.prevent="openFor('group', group.name)"
              >
                <span aria-hidden="true">⋯</span>
              </button>
              <div
                v-if="menuOpen('group', group.name)"
                class="favorites-menu"
                role="menu"
                :aria-label="`Actions for group ${group.name}`"
                @keydown="onMenuKey($event, group.name)"
              >
                <button type="button" role="menuitem" class="favorites-menu-item" @click="startRename(group.name)">
                  Rename
                </button>
                <button type="button" role="menuitem" class="favorites-menu-item" @click="removeGroup(group.name)">
                  Delete group
                </button>
              </div>
            </template>
          </div>
          <ul
            v-show="!isCollapsed(group.name)"
            class="favorites-list"
            :aria-label="group.name"
          >
            <li v-for="entry in group.entries" :key="entry.path" class="favorites-item">
              <a
                class="favorites-link"
                :href="linkFor(entry)"
                :title="pageId(entry.path) ?? entry.title"
                :data-fav-link="entry.path"
                @keydown="onViewKey($event, entry)"
                >{{ entry.title
                }}<span v-if="serviceOf(entry)" class="favorites-service">
                  <span aria-hidden="true">·&nbsp;</span>{{ serviceOf(entry) }}</span
                ></a
              >
              <button
                type="button"
                class="favorites-actions"
                :data-fav-actions="entry.path"
                :aria-label="`Actions for ${entry.title}`"
                aria-haspopup="menu"
                :aria-expanded="menuOpen('row', entry.path)"
                @click="toggleFor('row', entry.path)"
                @keydown.down.prevent="openFor('row', entry.path)"
                @keydown="onViewKey($event, entry)"
              >
                <span aria-hidden="true">⋯</span>
              </button>
              <button
                type="button"
                class="favorites-remove"
                :aria-label="`Remove ${entry.title} from Favorites`"
                @click="removeEntry(entry)"
                @keydown="onViewKey($event, entry)"
              >
                <span aria-hidden="true">✕</span>
              </button>
              <div
                v-if="menuOpen('row', entry.path)"
                class="favorites-menu"
                role="menu"
                :aria-label="`Actions for ${entry.title}`"
                @keydown="onMenuKey($event, entry.path)"
              >
                <template v-if="openMenu?.level === 'menu'">
                  <button
                    type="button"
                    role="menuitem"
                    class="favorites-menu-item"
                    @click="showGroupLevel"
                    @keydown.right.prevent="showGroupLevel"
                  >
                    Move to group…<span class="favorites-menu-more" aria-hidden="true">›</span>
                  </button>
                  <button type="button" role="menuitem" class="favorites-menu-item" @click="removeEntry(entry)">
                    Remove from Favorites
                  </button>
                </template>
                <template v-else>
                  <p class="favorites-menu-label">Move to group</p>
                  <button
                    v-for="name in groupTargets()"
                    :key="name"
                    type="button"
                    role="menuitemradio"
                    class="favorites-menu-item"
                    :aria-checked="groupOf(entry) === name"
                    @click="moveEntry(entry, name)"
                  >
                    <span class="favorites-menu-check" aria-hidden="true">{{
                      groupOf(entry) === name ? "✓" : ""
                    }}</span>{{ name }}
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    class="favorites-menu-item"
                    :aria-checked="groupOf(entry) === UNGROUPED"
                    @click="moveEntry(entry, null)"
                  >
                    <span class="favorites-menu-check" aria-hidden="true">{{
                      groupOf(entry) === UNGROUPED ? "✓" : ""
                    }}</span>{{ UNGROUPED }}
                  </button>
                  <hr class="favorites-menu-divider" />
                  <button type="button" role="menuitem" class="favorites-menu-item" @click="startCreate(entry.path)">
                    New group…
                  </button>
                </template>
              </div>
            </li>
          </ul>
          <p
            v-if="group.entries.length === 0"
            v-show="!isCollapsed(group.name)"
            class="favorites-group-empty"
          >
            No favorites in this group.
          </p>
        </div>
      </template>
      <div
        v-if="toast"
        class="favorites-toast"
        role="status"
        aria-live="polite"
        @pointerenter="pauseToast"
        @pointerleave="resumeToast"
        @focusin="pauseToast"
        @focusout="resumeToast"
      >
        <span class="favorites-toast-text">{{ toast.text }}</span>
        <button type="button" class="favorites-undo" @click="undoLast">Undo</button>
      </div>
      <span class="favorites-live" role="status" aria-live="polite">{{ announcement }}</span>
    </template>
    <template v-else>
      <button
        type="button"
        class="favorites-toggle"
        :aria-expanded="!collapsed"
        aria-controls="favorites-list"
        @click="toggle"
      >
        <span
          class="favorites-caret"
          :class="{ open: !collapsed }"
          aria-hidden="true"
          >›</span
        >
        <span class="favorites-heading">★ Favorites ({{ entries.length }})</span>
      </button>
      <ul v-show="!collapsed" id="favorites-list" class="favorites-list">
        <li v-for="entry in entries" :key="entry.path" class="favorites-item">
          <a class="favorites-link" :href="linkFor(entry)">{{ entry.title }}</a>
          <button
            type="button"
            class="favorites-remove"
            :title="`Remove ${entry.title} from favorites`"
            :aria-label="`Remove ${entry.title} from favorites`"
            @click="unstar(entry)"
          >
            ✕
          </button>
        </li>
      </ul>
    </template>
  </nav>
</template>
