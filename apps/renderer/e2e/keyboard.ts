// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keyboard-only helpers for P3-R2 (WCAG 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11): Tab to a control instead of clicking
 * it, and at every stop on the way read whether the focused element shows a ring and whether something else
 * covers it entirely (the window bar, the dock, a toast). Findings are collected, so one run lists them all.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export interface FocusStop {
  readonly name: string;
  /** No element has focus (the document body): the last action dropped it. */
  readonly lost: boolean;
  /**
   * The page's main area: where Skip to content puts focus, and a navigation that took away what had it. A landmark,
   * not a control, so it takes no ring (DESIGN.md "Skip to content").
   */
  readonly landing?: boolean;
  /** An outline, a box-shadow ring, or a ring on an ancestor within three levels while it has focus. */
  readonly ringShown: boolean;
  /** Every sample point of its box is covered by something that isn't it (or is outside the window). */
  readonly obscured: boolean;
  /** What covers its middle, when it is obscured. */
  readonly coveredBy?: string;
}

/** What the focused element looks like now. */
export function focusStop(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body)
      return { name: '(body)', lost: true, ringShown: false, obscured: false };
    if (element.tagName === 'MAIN')
      return { name: 'main (the page)', lost: false, landing: true, ringShown: false, obscured: false };
    const label =
      element.getAttribute('aria-label') ??
      element.getAttribute('title') ??
      (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const name = `${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} "${label}"`;
    const ringOf = (node: Element, pseudo?: string) => {
      const style = getComputedStyle(node, pseudo);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      return outline || shadow;
    };
    // Its own ring, a pseudo-element's, or (for a visually hidden input) the ring a sibling draws for it.
    const sibling = (node: Element | null) => node !== null && ringOf(node);
    let ringShown =
      ringOf(element) ||
      ringOf(element, '::after') ||
      ringOf(element, '::before') ||
      sibling(element.nextElementSibling) ||
      sibling(element.previousElementSibling);
    let node: Element | null = element.parentElement;
    for (let depth = 0; !ringShown && node && depth < 3; depth += 1, node = node.parentElement) {
      if (node.matches(':focus-within') && ringOf(node)) ringShown = true;
    }
    const box = element.getBoundingClientRect();
    const inset = (size: number) => Math.min(4, size / 4);
    const points: [number, number][] = [
      [box.left + box.width / 2, box.top + box.height / 2],
      [box.left + inset(box.width), box.top + inset(box.height)],
      [box.right - inset(box.width), box.top + inset(box.height)],
      [box.left + inset(box.width), box.bottom - inset(box.height)],
      [box.right - inset(box.width), box.bottom - inset(box.height)],
    ];
    const visible = points.some(([x, y]) => {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit) || hit.contains(element));
    });
    const obscured = box.width > 0 && box.height > 0 && !visible;
    const [x, y] = points[0] ?? [0, 0];
    const hit = obscured ? document.elementFromPoint(x, y) : null;
    const coveredBy = hit
      ? `${hit.tagName.toLowerCase()}${hit.getAttribute('data-slot') ? `[data-slot=${hit.getAttribute('data-slot')}]` : ''} at ${Math.round(x)},${Math.round(y)}`
      : obscured
        ? `nothing (outside the ${window.innerWidth}×${window.innerHeight} window at ${Math.round(x)},${Math.round(y)})`
        : undefined;
    return { name, lost: false, ringShown, obscured, ...(coveredBy ? { coveredBy } : {}) };
  });
}

/** Problems seen at focus stops, one line each; empty when every stop was shown and in view. */
export class FocusLog {
  readonly problems: string[] = [];
  readonly stops: string[] = [];

  /** `edge`: Tab may pass the end of the page here, which leaves focus on the body for one press. */
  async check(page: Page, where: string, edge = false): Promise<FocusStop> {
    const stop = await focusStop(page);
    this.stops.push(`${where}: ${stop.lost && edge ? '(the end of the page)' : stop.name}`);
    if (stop.lost) {
      if (!edge) this.problems.push(`${where}: focus fell to the page body`);
    } else if (!stop.landing) {
      if (!stop.ringShown) this.problems.push(`${where}: no visible focus on ${stop.name}`);
      if (stop.obscured)
        this.problems.push(`${where}: ${stop.name} is entirely covered, by ${stop.coveredBy ?? '?'}`);
    }
    return stop;
  }
}

/**
 * Presses Tab (or Shift+Tab) until `target` has focus, checking each stop on the way; fails after `max` presses.
 * Returns how many presses it took.
 */
export async function tabTo(
  page: Page,
  target: Locator,
  log: FocusLog,
  options: { readonly back?: boolean; readonly max?: number; readonly where?: string } = {},
): Promise<number> {
  const max = options.max ?? 60;
  const key = options.back ? 'Shift+Tab' : 'Tab';
  await target.waitFor({ state: 'attached', timeout: 10_000 });
  for (let presses = 0; presses <= max; presses += 1) {
    if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))) {
      await log.check(page, options.where ?? 'arrived');
      return presses;
    }
    await page.keyboard.press(key);
    await log.check(page, options.where ?? 'on the way', true);
  }
  await expect(target, `${options.where ?? 'target'}: not reached with ${max} × ${key}`).toBeFocused();
  return max;
}

/**
 * Tabs through the page from the top, checking each stop, until focus leaves the page or comes back to the
 * first stop, or after `max` presses. A press that leaves focus where it was is a trap (2.1.2). Returns the stops.
 */
export async function walkTabs(page: Page, log: FocusLog, where: string, max = 40): Promise<number> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const ids = await page.evaluateHandle(() => new WeakMap<Element, number>());
  let first = -1;
  let last = -1;
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press('Tab');
    const id = await ids.evaluate((map, next) => {
      const element = document.activeElement;
      if (!element || element === document.body) return -1;
      if (!map.has(element)) map.set(element, next);
      return map.get(element) ?? -1;
    }, presses);
    if (id === -1 || id === first) return presses - 1;
    if (id === last) {
      log.problems.push(`${where}: Tab stays on ${(await focusStop(page)).name} (stop ${presses})`);
      return presses;
    }
    if (first === -1) first = id;
    last = id;
    await log.check(page, `${where} stop ${presses}`);
  }
  return max;
}
