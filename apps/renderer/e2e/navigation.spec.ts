// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Back, Forward and the way up (UX1 nav, DESIGN.md "Window" v0.4): the window bar's chevrons, ⌘[ ⌘] and the crumbs
// step through the window's history; a page you come back to is as you left it (its scroll, the link you left by);
// ⌘[ works on every page; Settings' Back to app returns where you were; the skip link and a page that isn't found.
// The View menu, the swipe and the mouse's buttons on Windows are main's: apps/desktop/test/navigation-menu.test.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { PROJECT, ROUTES, TEMPLATE, type RouteSample } from './routes.ts';
import { fakeChat, open, preferences } from './support.ts';
import { fakes } from './ui2b-support.ts';

// The hub is Start from… › Community (UX4 tpl).
const HUB_TEMPLATE = '/templates/start/community/01K7C5M6Q8H000000000000001';
/** Reads slower than the 2.5 s the way back used to wait for a list (UX2-FIXUP), as a busy Mac's can be. */
const SLOW_READS_MS = 3000;
/** Clips in that library: one read's worth, so its end is one slow read away rather than twenty-five. */
const SLOW_LIBRARY = 120;
const bar = (page: Page) => page.locator('[data-slot=window-bar]');
const title = (page: Page) => bar(page).getByRole('heading', { level: 1 });
const back = (page: Page) => bar(page).getByRole('button', { name: 'Back', exact: true });
const forward = (page: Page) => bar(page).getByRole('button', { name: 'Forward', exact: true });
const crumb = (page: Page, name: string) => bar(page).getByRole('link', { name, exact: true });
const tiles = (page: Page) => page.locator('[data-slot=clip-grid] a');
/** The shell's scrolling column (shell/app-shell.tsx), or Settings'. */
const scroller = (page: Page) =>
  page.locator('main').locator('xpath=ancestor::*[@data-slot="scroll-area"][1]');
const scrollTop = (page: Page) => scroller(page).evaluate((el) => Math.round(el.scrollTop));
/** Path and search, as the router has them. */
const here = (page: Page) => {
  const url = new URL(page.url());
  return url.pathname + url.search;
};

test.beforeEach(async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { latencyMs: 0 });
});

test('Back and Forward step through the window’s history, and are off at its ends', async ({ page }) => {
  await open(page, { name: 'library', path: '/library' });
  await expect(bar(page).getByRole('group', { name: 'History' })).toBeVisible();
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeDisabled();
  await expect(back(page)).toHaveAttribute('aria-keyshortcuts', 'Meta+[');

  const clip = (await tiles(page).first().getAttribute('href')) ?? '';
  await tiles(page).first().click();
  await expect.poll(() => here(page)).toBe(clip);
  // The way up: "Library ›" before the clip's name, a link to the library.
  await expect(crumb(page, 'Library')).toHaveAttribute('href', '/library');
  await expect(title(page)).toContainText(/^Library.+/);
  await expect(back(page)).toBeEnabled();
  await expect(forward(page)).toBeDisabled();

  // By the button…
  await back(page).click();
  await expect.poll(() => here(page)).toBe('/library');
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeEnabled();
  await forward(page).click();
  await expect.poll(() => here(page)).toBe(clip);
  await expect(forward(page)).toBeDisabled();

  // …by ⌘[ and ⌘]…
  await page.keyboard.press('ControlOrMeta+BracketLeft');
  await expect.poll(() => here(page)).toBe('/library');
  await page.keyboard.press('ControlOrMeta+BracketRight');
  await expect.poll(() => here(page)).toBe(clip);

  // …and by the crumb, which steps back to the library you came from rather than opening it anew.
  await crumb(page, 'Library').click();
  await expect.poll(() => here(page)).toBe('/library');
  await expect(forward(page)).toBeEnabled();

  // The View menu's Back and Forward, and ⌘K's, run the same items (ui.action from main).
  await expect(async () => {
    await backend.menu(page, 'nav.forward');
    expect(here(page)).toBe(clip);
  }).toPass();
  await backend.menu(page, 'nav.back');
  await expect.poll(() => here(page)).toBe('/library');
});

test('every page under another shows the way up as links, opened on its own too', async ({ page }) => {
  await open(page, { name: 'templates-hub-template', path: HUB_TEMPLATE });
  await expect(crumb(page, 'Templates')).toHaveAttribute('href', '/templates');
  await expect(crumb(page, 'Start from…')).toHaveAttribute('href', '/templates/start');
  await expect(crumb(page, 'Community')).toHaveAttribute('href', '/templates/start/community');
  await expect(title(page)).toContainText('Morning café');
  // Opened on its own there is nothing to go back to: the crumb opens the community, and Back returns here.
  await expect(back(page)).toBeDisabled();
  await crumb(page, 'Community').click();
  await expect.poll(() => here(page)).toBe('/templates/start/community');
  await expect(title(page)).toHaveText(/^Templates.*Start from….*Community$/);
  await page.keyboard.press('ControlOrMeta+BracketLeft');
  await expect.poll(() => here(page)).toBe(HUB_TEMPLATE);

  const ups: [string, string, string][] = [
    ['/templates/start/community', 'Start from…', '/templates/start'],
    [`/templates/${TEMPLATE}/slots`, 'Templates', '/templates'],
    ['/templates/saved/settings', 'Saved', '/templates/saved'],
    ['/renders', 'Make', '/projects'],
    [`/projects/${PROJECT}/timeline`, 'Make', '/projects'],
    ['/settings/brand/01K7C5M6Q8Z000000000000001', 'Brand kits', '/settings/brand'],
    // UX4 set: a section's view leads up to the section; Updates, This Mac and About to General, which stands for them.
    ['/settings/usage/budgets', 'Usage', '/settings/usage'],
    ['/settings/privacy/sharing', 'Privacy', '/settings/privacy'],
    ['/settings/updates', 'General', '/settings/general'],
    ['/settings/about', 'General', '/settings/general'],
    ['/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6', 'Agent', '/chat'],
  ];
  for (const [path, name, to] of ups) {
    await open(page, { name: path, path });
    await expect(crumb(page, name), path).toHaveAttribute('href', to);
  }
  // The areas themselves have nothing above them.
  for (const path of ['/library', '/templates', '/projects', '/chat']) {
    await open(page, { name: path, path });
    await expect(bar(page).locator('[data-slot=window-crumb]'), path).toHaveCount(0);
  }
});

/** How a list is left and come back to (leaveAndComeBack). */
interface Leave {
  /** A page that goes on below its list (Templates, since UX1): the list to scroll to its end. */
  readonly end?: string;
  /** How long a list that loads slowly on purpose may take, for the waits on it. */
  readonly patience?: number;
  /** Comes back with the next page's code held on its way, so before that page shows (its bones do). */
  readonly beforeItShows?: boolean;
}

/**
 * Scrolls a list to its end, leaves by the last item that is wholly on screen and comes back with ⌘[: the list is
 * where it was and the item has focus, so the arrows and Tab carry on from it. Items are found again by `by` (a
 * link's href, a virtual row's index). A page that goes on below its list scrolls to the list's end instead of its
 * own (`end`), since a virtual list scrolled out of sight draws no rows at all.
 */
async function leaveAndComeBack(
  page: Page,
  route: RouteSample,
  items: string,
  by: 'href' | 'data-index',
  { end, patience, beforeItShows = false }: Leave = {},
) {
  const waits = patience === undefined ? {} : { timeout: patience };
  if (patience === undefined) await open(page, route);
  else await page.goto(route.path);
  await expect(page.locator(items).first()).toBeVisible(waits);
  if (end) await page.locator(end).evaluate((el) => el.scrollIntoView({ block: 'end' }));
  else await scroller(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  // A short list may sit above a page's end: bring its last drawn item to the middle (a long one stays at its end).
  await expect.poll(() => page.locator(items).count(), waits).toBeGreaterThan(0);
  await page
    .locator(items)
    .last()
    .evaluate((item) => item.scrollIntoView({ block: 'center' }));
  // A virtual list draws the rows it scrolled to over the next frames.
  const lastOnScreen = () =>
    page.evaluate(
      ([selector, attribute]) => {
        const onScreen = [...document.querySelectorAll(selector)].filter((item) => {
          const box = item.getBoundingClientRect();
          return box.top > 120 && box.bottom < window.innerHeight - 8;
        });
        return onScreen.at(-1)?.getAttribute(attribute) ?? null;
      },
      [items, by] as const,
    );
  await expect.poll(lastOnScreen, { message: `${route.path}: an item on screen`, ...waits }).not.toBeNull();
  const id = await lastOnScreen();
  expect(id, `${route.path}: an item on screen`).not.toBeNull();
  const item = page.locator(`${items}[${by}="${id}"]`);
  // The pointer goes to it first: Playwright may scroll a little to reach it, and where you left is where you clicked.
  await item.hover();
  const left = await scrollTop(page);
  const held: Route[] = [];
  if (beforeItShows) await page.route('**/assets/*.js', (script) => void held.push(script));
  await item.click();
  await expect.poll(() => here(page)).not.toBe(route.path);
  if (beforeItShows) await expect(page.locator('[data-slot=page-skeleton]')).toBeVisible();
  // A new page opens at its top (once it has loaded and replaced the list).
  else
    await expect
      .poll(() => scrollTop(page), { message: `${route.path}: the next page at its top`, ...waits })
      .toBe(0);
  await page.keyboard.press('ControlOrMeta+BracketLeft');
  await expect.poll(() => here(page)).toBe(route.path);
  await expect.poll(() => scrollTop(page), { message: `${route.path}: scrolled back`, ...waits }).toBe(left);
  await expect(item).toBeFocused(waits);
  // The held code goes on its way (anything asked for after this, unroute lets through).
  for (const script of held.splice(0)) await script.continue();
  if (beforeItShows) await page.unroute('**/assets/*.js');
}

test('a list you come back to is where you left it, with focus on what you opened', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await leaveAndComeBack(page, { name: 'library', path: '/library' }, '[data-slot=clip-grid] a', 'href');
  await leaveAndComeBack(
    page,
    { name: 'templates', path: '/templates' },
    '[data-slot=template-row]',
    'data-index',
    {
      end: '[data-slot=template-list]',
    },
  );
  await leaveAndComeBack(
    page,
    { name: 'projects', path: '/projects' },
    '[data-slot=project-row] a[href*="/timeline"]',
    'href',
  );
});

test('a list that loads slowly still comes back where you left it, with focus on what you opened', async ({
  page,
}) => {
  // The fake's clip and template reads take 3 s each: the way back used to give up after 2.5 s, and on a busy Mac
  // the list came back at its top (Templates) or without focus (Library). The import holds still, so the clips are
  // read once. At least four 3 s reads (each list, there and back): more than the default 30 s leaves a busy Mac.
  test.setTimeout(90_000);
  await fakes(page, {
    latencyMs: 0,
    libraryLatencyMs: SLOW_READS_MS,
    library: SLOW_LIBRARY,
    indexingTickMs: 0,
  });
  await page.setViewportSize({ width: 1024, height: 640 });
  const patience = SLOW_READS_MS + 5000;
  await leaveAndComeBack(page, { name: 'library', path: '/library' }, '[data-slot=clip-grid] a', 'href', {
    patience,
  });
  await leaveAndComeBack(
    page,
    { name: 'templates', path: '/templates' },
    '[data-slot=template-row]',
    'data-index',
    {
      end: '[data-slot=template-list]',
      patience,
    },
  );
});

test('a list you come back to before the next page shows is where you left it', async ({ page }) => {
  // The template's code is held on its way, so its bones take the list's place, and ⌘[ comes back before it shows.
  // To the router you never left Templates; until UX2-FIXUP the list came back at its top (a busy Mac's way back).
  await page.setViewportSize({ width: 1024, height: 640 });
  await leaveAndComeBack(
    page,
    { name: 'templates', path: '/templates' },
    '[data-slot=template-row]',
    'data-index',
    {
      end: '[data-slot=template-list]',
      beforeItShows: true,
    },
  );
});

test('⌘[ and ⌘] work on every page, whatever has focus', async ({ page }) => {
  test.setTimeout(180_000);
  const pages = ROUTES.filter((route) => !route.path.startsWith('/onboarding') && route.name !== 'root');
  for (const route of pages) {
    await open(page, route);
    const start = route.lands ?? route.path;
    const settings = start.startsWith('/settings');
    // A section every settings page lists on its rail (About is a view of General's now, not a section).
    const away = settings
      ? start === '/settings/memory'
        ? '/settings/models'
        : '/settings/memory'
      : start === '/library'
        ? '/templates'
        : '/library';
    await page.locator(`a[href="${away}"]`).first().click();
    await expect.poll(() => here(page), `${route.name}: away`).toBe(away);
    await page.keyboard.press('ControlOrMeta+BracketLeft');
    await expect.poll(() => here(page), `${route.name}: ⌘[ comes back`).toBe(start);
    // With focus in the page's own content: its keys don't swallow ⌘].
    const focusable = page
      .locator('main')
      .locator('a[href], button:not([disabled]), input, textarea, [tabindex="0"]');
    if ((await focusable.count()) > 0) await focusable.first().focus();
    await page.keyboard.press('ControlOrMeta+BracketRight');
    await expect.poll(() => here(page), `${route.name}: ⌘] goes on`).toBe(away);
  }
});

test('in the editor, ⌘[ goes back while a clip has focus; [ still trims it', async ({ page }) => {
  await open(page, { name: 'projects', path: '/projects' });
  await page.locator('[data-slot=project-row] a[href*="/timeline"]').first().click();
  await expect.poll(() => here(page)).toMatch(/\/timeline/);
  const clip = page.getByRole('listbox', { name: 'Clips' }).getByRole('option').first();
  await clip.focus();
  await page.keyboard.press('ControlOrMeta+BracketLeft');
  await expect.poll(() => here(page)).toBe('/projects');
});

test('Settings’ Back to app returns to the page it was opened from', async ({ page }) => {
  await open(page, { name: 'templates-start-community', path: '/templates/start/community' });
  // ⌘, is the palette's item, bound once its chunk has arrived.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+Comma');
    expect(here(page)).toBe('/settings/general');
  }).toPass();
  await page.getByRole('link', { name: 'Memory', exact: true }).click();
  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect.poll(() => here(page)).toBe('/settings/privacy');
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect.poll(() => here(page)).toBe('/templates/start/community');
  // Opened first, with nothing before it, it goes to the chat.
  await open(page, { name: 'settings-usage', path: '/settings/usage' });
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect.poll(() => here(page)).toMatch(/^\/chat/);
});

test('the agent’s go.projects still opens the Make area’s page; ⌘K lists it once, with Exports', async ({
  page,
}) => {
  await open(page, { name: 'library', path: '/library' });
  await backend.menu(page, 'go.projects');
  await expect.poll(() => here(page)).toBe('/projects');
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Commands' });
  const go = palette.getByRole('group', { name: 'Go to' });
  await expect(go.getByRole('option', { name: /^Make/ })).toHaveCount(1);
  await expect(go.getByRole('option', { name: /^Projects/ })).toHaveCount(0);
  await expect(go.getByRole('option', { name: /^Exports/ })).toHaveCount(1);
  await expect(go.getByRole('option', { name: /^Back/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(go.getByRole('option', { name: /^Forward/ })).toHaveAttribute('aria-disabled', 'true');
});

test('the first Tab stop skips to the page; a missing page keeps the sidebar', async ({ page }) => {
  await open(page, { name: 'library', path: '/library' });
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true);

  await open(page, { name: 'not-found', path: '/no-such-page' });
  // The page's own heading is the h1; the bar names it.
  await expect(bar(page).locator('[data-slot=window-title]')).toHaveText('Page not found');
  await expect(page.getByRole('navigation', { name: 'Areas' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText(/This page doesn.t exist/);
});

test('below 1100 px the sidebar folds to its rail by itself, and opens on request', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await open(page, { name: 'library', path: '/library' });
  const lead = page.locator('[data-slot=window-bar-lead]');
  const toggle = bar(page).getByRole('button', { name: 'Sidebar' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await lead.boundingBox())?.width).toBe(240);
  // Wide again, the person's own setting (open) holds.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the bar with its way up passes axe (${theme})`, async ({ page }, testInfo) => {
    await preferences(page, { theme });
    await open(page, { name: 'library', path: '/library' });
    await tiles(page).first().click();
    await expect(crumb(page, 'Library')).toBeVisible();
    await expectAccessible(page, testInfo, `clip, ${theme}`);
    await open(page, { name: 'templates-hub-template', path: HUB_TEMPLATE });
    await expectAccessible(page, testInfo, `hub template, ${theme}`);
  });
}

test('in the pseudo-locale the way up fits the bar, the page’s name kept whole first', async ({ page }) => {
  await preferences(page, { locale: 'en-XA' });
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await open(page, { name: 'templates-hub-template', path: HUB_TEMPLATE });
    const crumbs = bar(page).locator('[data-slot=window-crumb]');
    // Templates › Start from… › Community (UX4 tpl: the hub is a view of Start from…).
    await expect(crumbs).toHaveCount(3);
    await expect(crumbs.first()).not.toHaveText('Templates');
    await expect(bar(page).locator('[data-slot=history-step]').first()).not.toHaveAccessibleName('Back');
    // Nothing in the bar spills past it.
    const spill = await bar(page).evaluate((el) => {
      const edge = el.getBoundingClientRect().right;
      return [...el.querySelectorAll('*')].filter((child) => child.getBoundingClientRect().right > edge + 1)
        .length;
    });
    expect(spill, `${width}px`).toBe(0);
  }
});
