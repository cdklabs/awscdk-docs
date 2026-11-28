/**
 * Stops the release of an Escape key that a component has already acted on.
 *
 * VitePress closes the whole sidebar drawer when Escape is RELEASED (a window `keyup` listener). A component that
 * uses the Escape keydown for something smaller (folding the rail, hiding a tooltip) must also stop the keyup, or
 * one Escape does both and moves focus out of the drawer. The listener is registered at the window in the capture
 * phase, ahead of VitePress's own, and removed once the Escape release arrives; other keys (a modifier released
 * first, say) pass through and leave it in place. If the window loses focus before the release, the release never
 * arrives, so a blur removes the listener too.
 */
export function swallowEscapeRelease(): void {
  const done = (): void => {
    window.removeEventListener('keyup', onKeyup, { capture: true });
    window.removeEventListener('blur', done);
  };
  const onKeyup = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    done();
  };
  window.addEventListener('keyup', onKeyup, { capture: true });
  window.addEventListener('blur', done);
}
