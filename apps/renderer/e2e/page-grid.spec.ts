// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The page grid (UX4, DESIGN.md "Window" and "Page"): on every page in the shell, the window bar's title starts on
// the content column's left edge and the page's actions end on its right edge (or 8 px before the bar's own end,
// when that comes first), at 1100, 1280, 1600 and 1920 px, with the sidebar open and folded to its rail. Within 1 px. The Avartan mark travels with the title: it sits
// just before the title or its first crumb (nothing between them, the bar's 12 px gap), hanging into the gutter,
// while Back and Forward stay at the bar's start. The editor (edge to edge) and first run (its own frame) are off
// the grid.
import { expect, test, type Page } from '@playwright/test';
import { ROUTES, type RouteSample } from './routes.ts';
import { fakeChat, open, preferences } from './support.ts';

const WIDTHS = [1100, 1280, 1600, 1920] as const;
const OFF_GRID = /^\/(onboarding|projects\/[^/]+\/timeline)/;
const ON_GRID = ROUTES.filter((route) => !OFF_GRID.test(route.path));

interface Edges {
  title: number | null;
  column: { left: number; right: number } | null;
  actions: number | null;
  /** Where the bar's own end starts (the analysis count, the download), when it holds anything. */
  end: number | null;
  /** The mark's box, and whether the title's row comes straight after it. */
  mark: { left: number; right: number; middle: number; next: boolean } | null;
  /** Where the title's words sit vertically (their middle), and where Forward ends. */
  titleMiddle: number | null;
  forward: number | null;
}

/** Where the title's first letter starts, the column's edges, and where the page's own actions end. */
function edges(page: Page): Promise<Edges> {
  return page.evaluate(() => {
    const title = document.querySelector('[data-slot=window-bar] [data-slot=window-title]');
    // The first word on screen, not the heading's box: a crumb's hover pill reaches past its words.
    const walker = title ? document.createTreeWalker(title, NodeFilter.SHOW_TEXT) : null;
    let text = walker?.nextNode() ?? null;
    while (text && !text.textContent?.trim()) text = walker?.nextNode() ?? null;
    const range = document.createRange();
    if (text) range.selectNodeContents(text);
    const column = document.querySelector('main [data-slot=page]')?.getBoundingClientRect();
    const slot = document.querySelector('[data-slot=window-bar-actions]');
    const actions = slot && slot.querySelector('button, a') ? slot.getBoundingClientRect().right : null;
    const own = document.querySelector('[data-slot=window-bar-end]');
    const end = own && own.querySelector('button, a') ? own.getBoundingClientRect().left : null;
    const markEl = document.querySelector('[data-slot=window-bar] [data-slot=avartan-mark]');
    const markBox = markEl?.getBoundingClientRect();
    const words = text ? range.getBoundingClientRect() : null;
    const forward = document
      .querySelector('[data-slot=window-bar] button[aria-label=Forward]')
      ?.getBoundingClientRect();
    return {
      title: words ? words.left : null,
      column: column ? { left: column.left, right: column.right } : null,
      actions,
      end,
      mark: markBox
        ? {
            left: markBox.left,
            right: markBox.right,
            middle: markBox.top + markBox.height / 2,
            next: markEl?.nextElementSibling?.getAttribute('data-slot') === 'window-bar-title',
          }
        : null,
      titleMiddle: words ? words.top + words.height / 2 : null,
      forward: forward ? forward.right : null,
    };
  });
}

/** Two frames: the bar and the page have laid out at the new width. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

async function checkEveryWidth(page: Page, route: RouteSample) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const at = await edges(page);
    const where = `${route.path} at ${width}`;
    expect(at.column, `${where}: the page's column`).not.toBeNull();
    expect(at.title, `${where}: the bar's title`).not.toBeNull();
    expect(
      Math.abs(at.title! - at.column!.left),
      `${where}: title ${at.title} vs column ${at.column!.left}`,
    ).toBeLessThanOrEqual(1);
    // The page's actions end on the column's right edge, or 8 px before the bar's own end when that comes first
    // (LIB1-PROG: the analysis count and the download sit there; the bar measures them).
    const actionsEnd = at.end === null ? at.column!.right : Math.min(at.column!.right, at.end - 8);
    if (at.actions !== null)
      expect(
        Math.abs(at.actions - actionsEnd),
        `${where}: actions end ${at.actions} vs ${actionsEnd} (column ${at.column!.right}, bar end ${at.end})`,
      ).toBeLessThanOrEqual(1);
    expectMarkBeforeTitle(at, where);
  }
}

/** The mark sits just before the title's first word, on its line, and never before Forward ends. */
function expectMarkBeforeTitle(at: Edges, where: string) {
  expect(at.mark, `${where}: the mark`).not.toBeNull();
  expect(at.mark!.next, `${where}: the title's row comes straight after the mark`).toBe(true);
  const gap = at.title! - at.mark!.right;
  expect(gap, `${where}: mark ends ${at.mark!.right}, title starts ${at.title}`).toBeGreaterThanOrEqual(11);
  expect(gap, `${where}: mark ends ${at.mark!.right}, title starts ${at.title}`).toBeLessThanOrEqual(13);
  expect(
    Math.abs(at.mark!.middle - at.titleMiddle!),
    `${where}: the mark on the title's line`,
  ).toBeLessThanOrEqual(2);
  if (at.forward !== null)
    expect(at.mark!.left, `${where}: the mark after Forward`).toBeGreaterThan(at.forward);
}

for (const folded of [false, true]) {
  test.describe(folded ? 'sidebar on its rail' : 'sidebar open', () => {
    test.beforeEach(async ({ page }) => {
      await preferences(page, { theme: 'light', locale: 'en' });
      await fakeChat(page, { latencyMs: 0 });
      if (folded) await page.addInitScript(() => window.localStorage.setItem('taalcut.sidebar', 'collapsed'));
    });

    for (const route of ON_GRID) {
      test(`${route.name}: the title and actions sit on the column`, async ({ page }) => {
        await page.setViewportSize({ width: WIDTHS[0], height: 800 });
        await open(page, route);
        await checkEveryWidth(page, route);
      });
    }
  });
}

test('the title follows the column as the sidebar folds, with no jump at the end', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { latencyMs: 0 });
  await page.setViewportSize({ width: 1440, height: 800 });
  await open(page, { name: 'projects', path: '/projects' });
  await page.locator('[data-slot=window-bar]').getByRole('button', { name: 'Sidebar' }).click();
  await expect(page.locator('[data-slot=sidebar][data-rail]')).toBeVisible();
  await settled(page);
  const at = await edges(page);
  expect(Math.abs(at.title! - at.column!.left)).toBeLessThanOrEqual(1);
  expectMarkBeforeTitle(at, 'projects at 1440, folded');
});

test('crumbs start where the title would, with the mark before the first crumb', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { latencyMs: 0 });
  await page.setViewportSize({ width: 1600, height: 800 });
  await open(page, { name: 'chat-seeded', path: '/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6' });
  // A chat reads "Agent › its name": Agent is a crumb, a link.
  await expect(page.locator('[data-slot=window-bar] [data-slot=window-title] a').first()).toBeVisible();
  await settled(page);
  const at = await edges(page);
  expect(Math.abs(at.title! - at.column!.left)).toBeLessThanOrEqual(1);
  expectMarkBeforeTitle(at, 'a chat at 1600');
  // Back and Forward stay at the bar's start, away from the mark.
  expect(at.mark!.left - at.forward!).toBeGreaterThan(100);
});

test('without a page on the grid, the mark stays just after Forward', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { latencyMs: 0 });
  await page.setViewportSize({ width: 1600, height: 800 });
  await open(page, { name: 'projects', path: '/projects' });
  // The grid let go (as the editor does): the mark and title fall back to their own place after Forward.
  await page.evaluate(() => document.documentElement.removeAttribute('data-page-grid'));
  await settled(page);
  const at = await edges(page);
  expect(at.mark!.left - at.forward!).toBeGreaterThan(8);
  expect(at.mark!.left - at.forward!).toBeLessThanOrEqual(13);
  expectMarkBeforeTitle(at, 'off the grid');
});
