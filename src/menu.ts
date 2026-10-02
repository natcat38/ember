// iOS before 17 has no popover: there the menu button toggles `data-open`, which the CSS shows instead (audit #9).
// ponytail: no light dismiss in that fallback; the menu closes from its own buttons or a second tap on the opener.
const noPopover = typeof HTMLElement !== "undefined" && !("popover" in HTMLElement.prototype);

export function toggleMenu(id: string) {
  if (noPopover) document.getElementById(id)?.toggleAttribute("data-open");
}

export function closeMenu(el: HTMLElement | null | undefined) {
  if (noPopover) el?.removeAttribute("data-open");
  else el?.hidePopover();
}
