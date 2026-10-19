// Favorites plumbing shared by the theme's components: the store handle other
// components (the navbar type-ahead filter, the search dialog) read to boost
// starred pages, and cross-tab synchronization of the stored list. Result
// ordering itself happens where results are produced — SearchBox.vue reorders
// its hits with `rankFavoritesFirst` — so no global search hook is needed.
import { favoritesStore } from "./favorites";

/**
 * Install the shared favorites handle and the cross-tab storage listener.
 * Idempotent, client-only.
 */
export function installFavoritesSearchBoost(): void {
  if (typeof window === "undefined") {
    return;
  }
  const win = window as unknown as Record<string, unknown>;
  if (win.__cdkDocsFavoritesBoost) {
    return;
  }
  win.__cdkDocsFavoritesBoost = true;

  // Shared handle for other components (e.g. the navbar type-ahead filter) to
  // read and boost by starred status.
  win.__cdkDocsFavorites = favoritesStore();

  // Cross-tab sync: another tab starring a page updates this one.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith("cdk-docs:favourites")) {
      favoritesStore().reload();
    }
  });
}
