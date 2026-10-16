/**
 * Shared reactive signal between the "Locate current page" control
 * (JumpToCurrent.vue) and the lazy-loaded API sidebar (ApiSidebar.vue). A
 * module-level ref is enough — both components live in the same client app and
 * there is exactly one control.
 *
 * The signal is a monotonically increasing counter rather than a boolean so
 * consecutive activations each trigger the sidebar's watcher.
 */
import { ref } from 'vue';

/** Bumped once per activation of the jump-to-current control. */
export const jumpToCurrentRequest = ref(0);

/** Ask the API sidebar to reveal and scroll to the active page's entry. */
export function requestJumpToCurrent(): void {
  jumpToCurrentRequest.value += 1;
}
