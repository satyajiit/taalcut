// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 lane oc: the chat start's four ways in as choice tiles (packages/ui opening-choices.tsx, DESIGN.md v0.4).
// The tiles sit 2 × 2 (one column in a narrow column), keyboard order is reading order with an open way's panel
// right after its tile, the panel takes a full-width row under its tile's row, the motif plays one bar on hover
// and holds while open, reduced motion keeps everything still but a fade, axe is clean in both themes and the
// pseudo-locale fits.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { settle } from './axe.ts';
import { FocusLog, tabTo } from './keyboard.ts';
import { open, preferences } from './support.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, type Finding } from './inspect.ts';
import { expectAccessible, fakes, shoot } from './ui2b-support.ts';

/** Collected in the page from its first script on: every tile seen moved (reduced motion). */
declare global {
  interface Window {
    __moved?: string[];
  }
}

const CHAT = { name: 'chat', path: '/chat' };
const ways = (page: Page) => page.getByRole('list', { name: 'Ways to start' });
const tile = (page: Page, path: string) => page.locator(`li[data-path="${path}"] > button`);

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  expect(found, 'the element has a box').not.toBeNull();
  return found ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Each motif part's opacity and transform, as one string to compare poses. */
const pose = (page: Page, motif: string) =>
  page
    .locator(`[data-motif=${motif}] [data-part]`)
    .evaluateAll((parts) =>
      parts.map((p) => `${getComputedStyle(p).opacity} ${getComputedStyle(p).transform}`),
    );

/** The chat start's own region: the intro, the tiles with any open panel, and the recipe chips. */
const START = ['[data-slot=chat-start]', '[data-slot=new-chat-choices]'];

/**
 * ui2b-support's pseudo-locale checks on the chat start's region, plus no sideways scroll on the page. Scoped
 * because the sidebar's recent chats carry the person's titles in a title attribute, which inspect.ts doesn't
 * treat as user content yet (specs/requests-oc-to-orchestrator.md).
 */
async function expectStartClean(page: Page, label: string) {
  await settle(page);
  const found: Finding[] = await page.locator(START.join(', ')).evaluateAll((roots) => {
    const out: { text: string; where: string }[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim();
        const el = walker.currentNode.parentElement;
        if (text && el?.checkVisibility() && !el.closest('[translate="no"]'))
          out.push({ text, where: el.tagName.toLowerCase() });
      }
      for (const el of root.querySelectorAll('[aria-label], [placeholder], [title], [alt]'))
        for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
          const value = el.getAttribute(name)?.trim();
          if (value) out.push({ text: value, where: `${el.tagName.toLowerCase()} @${name}` });
        }
    }
    return out;
  });
  expect(found.length, `${label}: words found`).toBeGreaterThan(10);
  expect(englishShowing(found, englishPhrases()), `${label}: English source strings on screen`).toEqual([]);
  expect(untranslated(found), `${label}: strings that skipped the catalogue`).toEqual([]);
  const boxes = START.flatMap((root) => [root, `${root} *`]).join(', ');
  expect(await clippedText(page, boxes), `${label}: text that does not fit`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await fakes(page, { speed: 6 });
});

for (const theme of ['light', 'dark'] as const) {
  test(`the four ways in are a 2 × 2 grid of tiles, axe clean (${theme})`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await open(page, CHAT);
    await expect(ways(page).locator('li[data-path] > button')).toHaveCount(4);
    // The tiles rise into place: measure where they land.
    await settle(page);
    const [library, reference, template, describe] = await Promise.all([
      box(tile(page, 'library')),
      box(tile(page, 'reference')),
      box(tile(page, 'template')),
      box(tile(page, 'describe')),
    ]);
    expect(Math.round(reference.y)).toBe(Math.round(library.y));
    expect(Math.round(describe.y)).toBe(Math.round(template.y));
    expect(template.y).toBeGreaterThan(library.y + library.height);
    expect(Math.round(template.x)).toBe(Math.round(library.x));
    expect(reference.x).toBeGreaterThan(library.x + library.width);
    await shoot(page, `chat-start-${theme}`);
    await expectAccessible(page, testInfo, `chat start (${theme})`);

    await tile(page, 'reference').click();
    await expect(page.getByLabel('Link to a reel')).toBeFocused();
    await expectAccessible(page, testInfo, `chat start, Paste a reel open (${theme})`);
  });
}

test('keyboard: the tiles in reading order, an open way’s panel right after its tile', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, CHAT);
  const log = new FocusLog();
  await tabTo(page, tile(page, 'library'), log, { where: 'Use my library' });
  for (const path of ['reference', 'template', 'describe']) {
    await page.keyboard.press('Tab');
    await expect(tile(page, path)).toBeFocused();
  }
  // Open Paste a reel from the keyboard: the caret goes to the link; back is the tile, on is the panel, then
  // the next tile.
  await tabTo(page, tile(page, 'reference'), log, { back: true, where: 'back to Paste a reel' });
  await page.keyboard.press('Enter');
  await expect(tile(page, 'reference')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Link to a reel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(tile(page, 'reference')).toBeFocused();
  const presses = await tabTo(page, tile(page, 'template'), log, { where: 'Start from a template' });
  expect(presses, 'the panel’s controls come between the tile and the next one').toBeGreaterThan(1);
  await log.check(page, 'after the reel panel');
});

test('an open panel takes a full-width row under its tile’s row; the grid leaves no hole', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, CHAT);
  await settle(page);
  const list = await box(ways(page));

  await tile(page, 'reference').click();
  const reelRow = page.locator('li[data-panel-for="reference"]');
  await expect(reelRow).toBeVisible();
  await settle(page);
  // In the DOM it follows its tile (focus order); on screen it spans the grid under the first row.
  expect(await reelRow.evaluate((row) => row.previousElementSibling?.getAttribute('data-path'))).toBe(
    'reference',
  );
  const [row, library, reference, template] = await Promise.all([
    box(reelRow),
    box(tile(page, 'library')),
    box(tile(page, 'reference')),
    box(tile(page, 'template')),
  ]);
  expect(Math.round(row.x)).toBe(Math.round(list.x));
  expect(Math.round(row.width)).toBe(Math.round(list.width));
  expect(row.y).toBeGreaterThan(Math.max(library.y + library.height, reference.y + reference.height));
  expect(template.y).toBeGreaterThan(row.y + row.height);

  // A way in the second column of the first row is open: the first row stays whole, nothing jumps into its place.
  await tile(page, 'template').click();
  await expect(reelRow).toHaveCount(0);
  await settle(page);
  const templateRow = await box(page.locator('li[data-panel-for="template"]'));
  const [after, describe] = await Promise.all([box(tile(page, 'template')), box(tile(page, 'describe'))]);
  expect(Math.round(describe.y)).toBe(Math.round(after.y));
  expect(templateRow.y).toBeGreaterThan(after.y + after.height);
});

test('in a narrow column the tiles stack, one per row', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  // The tiles go two to a row from the column's own width (a 32rem container query), not the window's. Below
  // 1100 px the sidebar is its 56 px rail (nav, UX1), so an 800 px window still leaves a 680 px column, which is
  // wide enough for 2 × 2. A 600 px window leaves 480 px: a narrow column, which the test checks before it relies on it.
  await page.setViewportSize({ width: 600, height: 900 });
  await open(page, CHAT);
  await settle(page);
  const list = await box(ways(page));
  expect(list.width, 'the column is narrower than 32rem').toBeLessThan(512);
  const boxes = await Promise.all(
    ['library', 'reference', 'template', 'describe'].map((path) => box(tile(page, path))),
  );
  boxes.slice(1).forEach((here, i) => {
    const above = boxes[i] ?? here;
    expect(Math.round(here.x)).toBe(Math.round(above.x));
    expect(here.y).toBeGreaterThan(above.y + above.height);
  });
});

test('hover plays the motif’s one bar, holds it while open, and plays it back on leave', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, CHAT);
  const rest = await pose(page, 'template');
  await tile(page, 'template').hover();
  await expect.poll(() => pose(page, 'template')).not.toEqual(rest);
  await expect.poll(async () => (await pose(page, 'template')).every((p) => p.startsWith('1 '))).toBe(true);
  await page.mouse.move(4, 4);
  await expect.poll(() => pose(page, 'template')).toEqual(rest);
  // Open, it stays played with the pointer gone.
  await tile(page, 'template').click();
  await page.mouse.move(4, 4);
  await expect.poll(async () => (await pose(page, 'template')).every((p) => p.startsWith('1 '))).toBe(true);
});

test('reduced motion: the tiles fade in without moving and the motifs stay still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const moved: string[] = [];
    window.__moved = moved;
    const start = performance.now();
    const sample = () => {
      for (const li of document.querySelectorAll('li[data-path]')) {
        const transform = getComputedStyle(li).transform;
        if (transform !== 'none') moved.push(`${li.getAttribute('data-path')}: ${transform}`);
      }
      if (performance.now() - start < 3000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, CHAT);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__moved ?? ['the sampler never ran'])).toEqual([]);
  const rest = await pose(page, 'reference');
  await tile(page, 'reference').hover();
  await page.waitForTimeout(400);
  expect(await pose(page, 'reference')).toEqual(rest);
  await tile(page, 'reference').click();
  await page.waitForTimeout(400);
  expect(await pose(page, 'reference')).toEqual(rest);
});

test('the pseudo-locale: every word translated, nothing clipped, closed and open', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await page.setViewportSize({ width: 1024, height: 720 });
  await open(page, CHAT);
  await expectStartClean(page, 'chat start, en-XA');
  await tile(page, 'reference').click();
  await expect(page.locator('li[data-panel-for="reference"] input[type=url]')).toBeFocused();
  await expectStartClean(page, 'chat start, en-XA, Paste a reel open');
});

test('with an empty library, Use my library is still offered and says what it opens', async ({
  page,
}, testInfo) => {
  await fakes(page, { speed: 6, library: 'empty' });
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, CHAT);
  const library = tile(page, 'library');
  await expect(library).toBeEnabled();
  await expect(library).toHaveAttribute('data-hollow', 'true');
  await expect(library).toContainText('Nothing in it yet. Add a folder or connect your phone first.');
  await expect(library).toHaveAttribute('aria-expanded', 'false');
  await library.click();
  const panel = page.locator('li[data-panel-for="library"]');
  // UX4: the registry's one name for it, with its icon.
  await expect(panel.getByRole('button', { name: 'Add folder' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Connect phone' })).toBeVisible();
  await shoot(page, 'chat-start-empty-library');
  await expectAccessible(page, testInfo, 'chat start, empty library, its panel open');
});

test('starters that fail to load say so with Try again, in first run and in the chat', async ({
  page,
}, testInfo) => {
  await fakes(page, { speed: 6, onboarding: 'fresh', starters: 'error' });
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, { name: 'onboarding-first-video', path: '/onboarding/first-video' });
  await tile(page, 'template').click();
  const failed = page.locator('li[data-panel-for="template"] [data-slot=starters-failed]');
  await expect(failed).toHaveAttribute('role', 'alert');
  await expect(failed).toContainText('The starters didn’t load.');
  // Asking again shows the bones, then the same honest error (the fake keeps failing).
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(failed).toBeVisible();
  await shoot(page, 'first-run-starters-failed');
  await expectAccessible(page, testInfo, 'first run, starters failed');

  await fakes(page, { speed: 6, onboarding: 'done', starters: 'error' });
  await open(page, CHAT);
  await tile(page, 'template').click();
  await expect(page.locator('li[data-panel-for="template"] [data-slot=starters-failed]')).toContainText(
    'The starters didn’t load.',
  );
});
