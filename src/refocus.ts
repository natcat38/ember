// When the control a keyboard user just activated disappears (Take 5, Not today, Delete step...), focus falls to the
// page body and the next Tab starts again at the top (SC 2.4.3). Call this right after the change: once the new view has
// rendered, `find` names where focus goes next (the next row, or the new section's heading). It does nothing if focus
// has already landed somewhere, so it never steals it.
export function refocus(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    const now = document.activeElement;
    if (!now || now === document.body) find()?.focus();
  });
}
