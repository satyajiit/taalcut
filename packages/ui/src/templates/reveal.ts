// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The review panel's own scroll: what `reveal` scrolls, and nothing around it. */
export const REVIEW_SCROLL = 'data-review-scroll';

/**
 * Brings `el` into view inside the review panel's scroll only, the least distance needed. scrollIntoView would
 * also scroll the sheet and the page under it, moving the reel out from under the person.
 */
export function reveal(el: Element | null | undefined): void {
  const box = el?.closest<HTMLElement>(`[${REVIEW_SCROLL}]`);
  if (!el || !box) return;
  const inner = el.getBoundingClientRect();
  const outer = box.getBoundingClientRect();
  if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top;
  else if (inner.bottom > outer.bottom)
    box.scrollTop += Math.min(inner.bottom - outer.bottom, inner.top - outer.top);
}

/**
 * After a fix that takes its own button away (an answer, Looks right, Undo's last, Not text, a rename), focus lands on
 * the heading of what is current now, the whole reel's doubts or the slot, brought into view: a screen reader reads
 * where the review went, Tab goes on to its answers, and Space still plays. Never on a button: Space there would
 * approve or answer something unseen. `moved`: the review went on to something else (an answer, Looks right), so
 * focus follows it even from a button still there; else only when focus was lost. Tried again until the new version
 * has arrived, then only if focus was lost meanwhile.
 */
export function landOnActions(root: HTMLElement | null, moved = false): void {
  for (const [i, wait] of [0, 120, 400, 900].entries())
    window.setTimeout(
      () =>
        requestAnimationFrame(() => {
          const at = document.activeElement;
          const lost =
            !(at instanceof HTMLElement) || at === document.body || at.getAttribute('role') === 'dialog';
          if (!(moved && i === 0) && !lost && at.isConnected) return;
          const reel = root?.querySelector('[data-slot=reel-doubts] [data-current]');
          const target = root?.querySelector<HTMLElement>(`[data-landing=${reel ? 'reel' : 'slot'}]`);
          if (!target) return;
          target.focus({ preventScroll: true });
          reveal(target);
        }),
      wait,
    );
}

/**
 * J and K, Previous and Next or the arrows moved the selection while focus was on a slot in the strip: focus goes to
 * the newly selected slot (the strip's one tab stop), so one outline marks it, not two.
 */
export function followSelection(root: HTMLElement | null): void {
  requestAnimationFrame(() => {
    const at = document.activeElement;
    if (!(at instanceof HTMLElement) || at.getAttribute('role') !== 'option' || !root?.contains(at)) return;
    root
      .querySelector<HTMLElement>('[data-slot=slot-strip] [aria-selected=true]')
      ?.focus({ preventScroll: true });
  });
}
