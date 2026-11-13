// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The shell's motion: the sidebar folds to an icon rail (remembered across
// launches) with tooltips for its icons, starting to move in the frame after
// the click; the current row's mark glides to the new page; flipping light
// and dark with the sidebar's toggle plays nightfall or daybreak (a short
// crossfade with reduced motion, ⌘K or Match the Mac), while the Mac's own
// appearance changes are not animated. Screenshots land in
// e2e-artifacts/screenshots/<theme>/shell-*.png.
import { expect, test, type Page } from '@playwright/test';
import { ARTIFACTS, fakeChat, open, preferences } from './support.ts';

const SIDEBAR_STORAGE_KEY = 'taalcut.sidebar';
const LIBRARY = { name: 'library', path: '/library' };
const shot = (theme: string, name: string) =>
  new URL(`screenshots/${theme}/shell-${name}.png`, ARTIFACTS).pathname;
const toggle = (page: Page) =>
  page.locator('[data-slot=window-bar]').getByRole('button', { name: 'Sidebar' });
const sidebar = (page: Page) => page.locator('[data-slot=sidebar]');
const areas = (page: Page) => page.getByRole('navigation', { name: 'Areas' });

/** Starts with the sidebar folded, as a launch after folding it would. */
async function startFolded(page: Page): Promise<void> {
  await page.addInitScript((key) => window.localStorage.setItem(key, 'collapsed'), SIDEBAR_STORAGE_KEY);
}

/** Runs `act`, then returns the top edge of `selector` on every frame for the next 700 ms. */
async function topsWhile(page: Page, selector: string, act: () => Promise<void>): Promise<number[]> {
  const sampled = page.evaluate(
    (selector) =>
      new Promise<number[]>((resolve) => {
        const tops: number[] = [];
        const start = performance.now();
        const frame = () => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          if (box) tops.push(Math.round(box.top * 10) / 10);
          if (performance.now() - start < 700) requestAnimationFrame(frame);
          else resolve(tops);
        };
        requestAnimationFrame(frame);
      }),
    selector,
  );
  await act();
  return sampled;
}

/** Whether any sample lies strictly between the first and the last (the thing moved through, not jumped). */
function glided(tops: number[]): boolean {
  const from = tops[0] ?? 0;
  const to = tops.at(-1) ?? 0;
  return tops.some((top) => top > Math.min(from, to) + 1 && top < Math.max(from, to) - 1);
}

/** Records every value <html data-theme-transition> takes, from the first script on. */
async function recordThemeTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { themeTransitions: string[] }).themeTransitions = seen;
    new MutationObserver(() => {
      const value = document.documentElement.getAttribute('data-theme-transition');
      if (value) seen.push(value);
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme-transition'] });
  });
}

const transitionsSeen = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { themeTransitions: string[] }).themeTransitions]);

test.beforeEach(async ({ page }) => {
  await fakeChat(page, { latencyMs: 0 });
});

for (const theme of ['light', 'dark'] as const) {
  test(`the sidebar folds to an icon rail, stays folded at the next launch, and opens again (${theme})`, async ({
    page,
  }) => {
    await preferences(page, { theme, locale: 'en' });
    await open(page, LIBRARY);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page)).toHaveAttribute('id', 'app-sidebar');

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar(page)).toHaveAttribute('data-rail', 'true');
    await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(56);
    // The rail: ⌘K, the areas, New chat, Settings and the theme, as icons with their names kept for
    // screen readers; your chats fold away.
    await expect(page.getByRole('button', { name: 'Commands' })).toBeVisible();
    for (const name of ['Make', 'Library', 'Templates', 'Agent'])
      await expect(areas(page).getByRole('link', { name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New chat' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(
      sidebar(page).getByRole('button', { name: `Switch to ${theme === 'light' ? 'dark' : 'light'}` }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Trip to Goa reel/ })).toBeHidden();
    // Only the current area's icon has its accent; the row's mark is icon-sized.
    const mark = areas(page).getByRole('link', { name: 'Library' }).locator('[data-slot=current-indicator]');
    expect((await mark.boundingBox())?.width).toBe(40);
    await page.screenshot({ path: shot(theme, 'rail') });
    expect(await page.evaluate((key) => window.localStorage.getItem(key), SIDEBAR_STORAGE_KEY)).toBe(
      'collapsed',
    );

    // The next launch starts on the rail, without folding again.
    await page.reload();
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute('data-rail', 'true');
    expect((await sidebar(page).boundingBox())?.width).toBe(56);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');

    // Its button opens it again (⌃⌘S too: window-bar.spec.ts), words and chats back.
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(240);
    await expect(page.getByRole('link', { name: /Trip to Goa reel/ })).toBeVisible();
    await expect(areas(page).getByText('Templates')).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), SIDEBAR_STORAGE_KEY)).toBeNull();
  });
}

test('a rail icon’s name: at once on keyboard focus, after a wait under the pointer', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await startFolded(page);
  await open(page, LIBRARY);
  const tooltip = page.getByRole('tooltip');

  // Tab onto Templates: its name shows at once and describes the link.
  await areas(page).getByRole('link', { name: 'Library' }).focus();
  await page.keyboard.press('Tab');
  const templates = areas(page).getByRole('link', { name: 'Templates' });
  await expect(templates).toBeFocused();
  await expect(tooltip).toHaveText('Templates', { timeout: 300 });
  await expect(templates).toHaveAttribute('aria-describedby', /.+/);
  // ⌘K's carries its shortcut.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Commands' })).toBeFocused();
  await expect(tooltip).toContainText('Commands');
  await expect(tooltip.locator('kbd')).toHaveText('⌘K');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);

  // Under the pointer it waits (800 ms) before showing.
  await page.locator('h1').first().click();
  await page.waitForTimeout(400);
  await areas(page).getByRole('link', { name: 'Agent' }).hover();
  await page.waitForTimeout(300);
  await expect(tooltip).toHaveCount(0);
  await expect(tooltip).toHaveText('Agent', { timeout: 1500 });

  // Open, the sidebar shows no tooltips: the words are on the rows.
  await page.mouse.move(800, 400);
  await page.keyboard.press('Control+Meta+KeyS');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await areas(page).getByRole('link', { name: 'Make' }).hover();
  await page.waitForTimeout(1200);
  await expect(tooltip).toHaveCount(0);
});

test('the current row’s mark glides to the new page, open and on the rail; reduced motion jumps', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, LIBRARY);
  const mark = '[data-slot=current-indicator]';
  const open1 = await topsWhile(page, mark, () => areas(page).getByRole('link', { name: 'Agent' }).click());
  expect(glided(open1), `tops ${open1.join(', ')}`).toBe(true);
  await expect(page.locator(mark)).toHaveCount(1);
  await expect(areas(page).getByRole('link', { name: 'Agent' }).locator(mark)).toHaveCount(1);
  await expect(areas(page).getByRole('link', { name: 'Agent' })).toHaveAttribute('aria-current', 'page');

  await toggle(page).click();
  await expect(sidebar(page)).toHaveAttribute('data-rail', 'true');
  const rail = await topsWhile(page, mark, () => areas(page).getByRole('link', { name: 'Make' }).click());
  expect(glided(rail), `tops ${rail.join(', ')}`).toBe(true);
  await expect(areas(page).getByRole('link', { name: 'Make' }).locator(mark)).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await topsWhile(page, mark, () =>
    areas(page).getByRole('link', { name: 'Library' }).click(),
  );
  expect(glided(reduced), `tops ${reduced.join(', ')}`).toBe(false);
  await expect(areas(page).getByRole('link', { name: 'Library' }).locator(mark)).toHaveCount(1);
});

test('flipping the theme plays nightfall and daybreak from the toggle, open and on the rail; other switches crossfade; the Mac’s is not animated', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await preferences(page, { theme: 'system', locale: 'en' });
  await recordThemeTransitions(page);
  await open(page, LIBRARY);
  const html = page.locator('html');
  const flip = (to: 'dark' | 'light') => sidebar(page).getByRole('button', { name: `Switch to ${to}` });
  const settled = async () => {
    await expect(html).not.toHaveAttribute('data-theme-transition', /.*/);
    await expect(page.locator('[data-theme-scene]')).toHaveCount(0);
  };

  // From Match the Mac (light here): one click is dark, at nightfall; the sun, moon and stars play over it.
  await flip('dark').click();
  await expect(page.locator('[data-theme-scene=nightfall] [data-scene-part=tc-scene-moon]')).toHaveCount(1);
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await settled();
  expect(await transitionsSeen(page)).toEqual(['nightfall']);

  // On the rail, the same button in the same place: daybreak.
  await toggle(page).click();
  await expect(sidebar(page)).toHaveAttribute('data-rail', 'true');
  await flip('light').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await settled();
  expect(await transitionsSeen(page)).toEqual(['nightfall', 'daybreak']);
  await expect(flip('dark')).toBeVisible();

  // Reduced motion: a short crossfade, no scene.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await flip('dark').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await settled();
  expect((await transitionsSeen(page)).at(-1)).toBe('fade');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Match the Mac lives in ⌘K (and Settings › About): choosing it crossfades.
  await page.keyboard.press('Meta+KeyK');
  await page.keyboard.type('Match the Mac');
  await page.keyboard.press('Enter');
  await expect(html).toHaveAttribute('data-theme-preference', 'system');
  await settled();
  expect((await transitionsSeen(page)).at(-1)).toBe('fade');

  // Following the Mac, its appearance changing is applied at once.
  const before = (await transitionsSeen(page)).length;
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toContain('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  expect(await transitionsSeen(page)).toHaveLength(before);
});

test('the fold starts in the frame after the click, every part on one clock', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, LIBRARY);
  // Click between frames, then read the sidebar's edge and the page beside it after each frame.
  const frames = await page.evaluate(async () => {
    const button = document.querySelector<HTMLElement>(
      '[data-slot=window-bar] button[aria-controls=app-sidebar]',
    );
    const clip = document.querySelector('[data-slot=sidebar-clip]');
    const pageEl = document.querySelector('[data-slot=fold-page]');
    if (!button || !clip || !pageEl) throw new Error('no sidebar');
    const at = () => ({
      edge: clip.getBoundingClientRect().right,
      page: pageEl.getBoundingClientRect().left,
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = at();
    button.click();
    const seen: ReturnType<typeof at>[] = [];
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      seen.push(at());
    }
    return { before, seen };
  });
  const first = frames.seen[0];
  // The first frame after the click has already moved, though not all the way (the lead: one frame in).
  expect(first?.running).toBeGreaterThan(0);
  expect(first?.edge).toBeLessThan(frames.before.edge - 1);
  expect(first?.edge).toBeGreaterThan(56 + 1);
  // It moves on continuously to the rail, never back, and ends there.
  const edges = frames.seen.map((f) => f.edge);
  for (let i = 1; i < edges.length; i += 1) expect(edges[i]).toBeLessThanOrEqual((edges[i - 1] ?? 0) + 0.5);
  expect(edges.at(-1)).toBe(56);
});
