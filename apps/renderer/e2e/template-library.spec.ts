// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Browser, type Page } from '@playwright/test';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';
import { expectPseudoCleanWithin } from './templates-support.ts';
import { expectAccessible, fakeState } from './ui2b-support.ts';

/** P3-V14: the template library at scale, against the fake's 200 templates. */
const LIBRARY = { name: 'template-library', path: '/templates' };
const BY_NAME = { name: 'template-library-by-name', path: '/templates?sort=name&dir=asc' };
const SCREENS = process.env.TAALCUT_LIBRARY_SCREENS;

/** The fake's library of 200 templates (src/backend/fake/options/library.ts). */
async function bigLibrary(page: Page): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ templates: 200, indexingTickMs: 0 }),
  });
}

const list = (page: Page) => page.locator('[data-slot=template-list]');
const rows = (page: Page) => list(page).getByRole('option');
const toast = (page: Page) => page.locator('[data-slot=toast]').last();

interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
  readonly args?: { readonly name?: string };
}

/** Frame times (between drawn frames while something moves) and the main thread's long tasks, in ms. */
function readTrace(buffer: Buffer): { frames: number[]; longTasks: number[] } {
  const events = (JSON.parse(buffer.toString()) as { traceEvents: TraceEvent[] }).traceEvents;
  const main = new Set(
    events
      .filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      .map((e) => `${e.pid}:${e.tid}`),
  );
  const drawn = events
    .filter((e) => e.name === 'DrawFrame')
    .map((e) => e.ts)
    .sort((a, b) => a - b);
  // A gap over 100 ms is the page at rest between steps, not a slow frame.
  const frames = drawn
    .slice(1)
    .map((ts, i) => (ts - drawn[i]!) / 1000)
    .filter((ms) => ms < 100);
  const longTasks = events
    .filter(
      (e) => e.name === 'RunTask' && e.ph === 'X' && main.has(`${e.pid}:${e.tid}`) && (e.dur ?? 0) > 50_000,
    )
    .map((e) => (e.dur ?? 0) / 1000);
  return { frames, longTasks };
}

const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Scrolls the main area by `pixels` over about `ms`, a wheel notch a frame. */
async function scroll(page: Page, pixels: number, steps = 40) {
  const box = await list(page).boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 200, 700));
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, pixels / steps);
    await page.waitForTimeout(16);
  }
}

async function traced(browser: Browser, page: Page, work: () => Promise<void>) {
  await browser.startTracing(page, {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'toplevel'],
  });
  await work();
  return readTrace(await browser.stopTracing());
}

test.describe('template library at scale (P3-V14)', () => {
  test.beforeEach(async ({ page }) => {
    await bigLibrary(page);
  });

  test('200 templates scroll, filter and re-sort at 60 fps with no long task', async ({ page, browser }) => {
    const problems = await watchProblems(page);
    await open(page, LIBRARY);
    await expect(rows(page).first()).toBeVisible();
    // Windowed: far fewer rows in the DOM than templates in the list.
    expect(await rows(page).count()).toBeLessThan(40);
    await expect(rows(page).first()).toHaveAttribute('aria-setsize', /^19\d$/);

    const { frames, longTasks } = await traced(browser, page, async () => {
      await scroll(page, 6000);
      await scroll(page, 6000);
      await page.getByRole('button', { name: 'Length' }).click();
      await page.getByRole('menuitemradio', { name: '15 to 30 seconds' }).click();
      await expect(list(page)).toBeVisible();
      await page.getByRole('button', { name: 'Recently changed' }).click();
      await page.getByRole('menuitemradio', { name: 'Name' }).click();
      await expect(page).toHaveURL(/sort=name/);
      await scroll(page, 3000);
      await scroll(page, -6000);
    });
    test.info().annotations.push({
      type: 'frames',
      description: `${frames.length} frames, median ${median(frames).toFixed(2)} ms; long tasks ${JSON.stringify(longTasks)}`,
    });
    expect(frames.length).toBeGreaterThan(30);
    expect(median(frames)).toBeLessThanOrEqual(16.7);
    expect(longTasks).toEqual([]);
    // Names A to Z, and only 15 to 30 second templates.
    await expect(page).toHaveURL(/length=medium/);
    expect(problems).toEqual([]);
  });

  // LRN1-FIX: with words the list is templates.search's answer (the panel lists its first results), one search at a
  // time with the newest words next: still within 100 ms of the last key, every row a match that says why.
  test('search answers within 100 ms of the last keystroke, and the words land in the URL', async ({
    page,
  }) => {
    await open(page, LIBRARY);
    await expect(rows(page).first()).toBeVisible();
    await page.evaluate(() => {
      const state = window as unknown as { lastKey: number; answered: Record<string, number> };
      state.answered = {};
      document.addEventListener('keydown', () => (state.lastKey = performance.now()), true);
      const target = document.querySelector('[data-slot=template-list]');
      if (!target) return;
      new MutationObserver(() => {
        state.answered[target.getAttribute('data-answers') ?? ''] ??= performance.now();
      }).observe(target, { attributes: true, attributeFilter: ['data-answers'] });
    });
    await page.keyboard.press('ControlOrMeta+f');
    // A combobox since LRN1-TPL: the field offers search by meaning in a panel under it (search/use-search-combobox).
    await expect(page.getByRole('combobox', { name: 'Search your templates' })).toBeFocused();
    await page.keyboard.type('market', { delay: 40 });
    await expect(list(page)).toHaveAttribute('data-answers', 'market');
    const elapsed = await page.evaluate(() => {
      const state = window as unknown as { lastKey: number; answered: Record<string, number> };
      return (state.answered['market'] ?? Number.POSITIVE_INFINITY) - state.lastKey;
    });
    test
      .info()
      .annotations.push({ type: 'search', description: `${elapsed.toFixed(1)} ms after the last key` });
    expect(elapsed).toBeLessThanOrEqual(100);
    for (const row of await rows(page).allInnerTexts()) {
      expect(row.toLowerCase()).toContain('market');
      expect(row).toContain('Matched by words');
    }
    await expect(page).toHaveURL(/q=market/);
  });

  test('keyboard only: select a run, tag it and move it to a folder', async ({ page }) => {
    await open(page, BY_NAME);
    await expect(rows(page).first()).toBeVisible();
    await page.keyboard.press('ControlOrMeta+f');
    for (let tab = 0; tab < 20; tab += 1) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'option')) break;
    }
    await expect(rows(page).first()).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(list(page).locator('[aria-selected=true]')).toHaveCount(3);
    const bar = page.getByRole('toolbar', { name: 'Selected templates' });
    await expect(bar).toContainText('3 selected');

    // Tag…: the bar is next in the tab order.
    await page.keyboard.press('Tab');
    await expect(bar.getByRole('button', { name: 'Tag…' })).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Tag 3 templates' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('Keyboard Only');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('checkbox', { name: 'keyboard-only' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await dialog.getByRole('button', { name: 'Save tags' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast(page)).toContainText('Tags saved on 3 templates');
    // The tag joins each one's tags (a row shows its first three, then "+1").
    await expect(list(page).locator('[aria-selected=true]', { hasText: /keyboard-only|\+\d/ })).toHaveCount(
      3,
    );

    // Move to…: a menu of folders, picked with the arrows.
    await bar.getByRole('button', { name: 'Move to…' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Client work' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Client work' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toast(page)).toContainText('Moved 3 templates to Client work');
    const moved = await fakeState<{ name: string }[]>(page, 'dispatched');
    expect(moved.filter((d) => d.name === 'template.moveToFolder')).toHaveLength(1);
    expect(moved.filter((d) => d.name === 'template.setTags')).toHaveLength(3);
    // Escape lets go of the selection.
    await rows(page).first().focus();
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
  });

  test('importing three files brings in two and names the one refused, with one Undo', async ({ page }) => {
    await open(page, BY_NAME);
    await rows(page).nth(0).locator('[data-slot=row-check]').click();
    await rows(page).nth(1).locator('[data-slot=row-check]').click();
    await page
      .getByRole('toolbar', { name: 'Selected templates' })
      .getByRole('button', { name: 'Export' })
      .click();
    await expect(toast(page)).toContainText('Saved 2 template files');
    const saved = await fakeState<{ fileName: string; text: string }[]>(page, 'templateLibrary.saved');
    expect(saved).toHaveLength(2);
    const before = await rows(page).first().getAttribute('aria-setsize');

    // Bringing files in is New's job (UX4 tpl); its toast and Undo go with you back to the list.
    const views = page.getByRole('navigation', { name: 'Templates' });
    await views.getByRole('link', { name: 'New' }).click();
    await page.locator('[data-slot=template-import-input]').setInputFiles([
      { name: saved[0]!.fileName, mimeType: 'application/json', buffer: Buffer.from(saved[0]!.text) },
      {
        name: 'broken.taalcut-template',
        mimeType: 'application/json',
        buffer: Buffer.from('{"format":"x"}'),
      },
      { name: saved[1]!.fileName, mimeType: 'application/json', buffer: Buffer.from(saved[1]!.text) },
    ]);
    await expect(toast(page)).toContainText('Imported 2 templates');
    await expect(toast(page)).toContainText('broken.taalcut-template isn’t a template Taalcut can read.');
    await views.getByRole('link', { name: 'Your templates' }).click();
    await expect(rows(page).first()).toHaveAttribute('aria-setsize', String(Number(before) + 2));
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(rows(page).first()).toHaveAttribute('aria-setsize', String(before));
  });

  test('folders: make one and open it from the URL; filters land in the URL', async ({ page }) => {
    await open(page, LIBRARY);
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByRole('textbox', { name: 'New folder name' }).fill('Reels for Maya');
    await page.keyboard.press('Enter');
    const rail = page.getByRole('navigation', { name: 'Template folders' });
    // A folder is a page of its own (UX4 tpl): the rail's places are links to /templates/folders/$folderId.
    await expect(rail.getByRole('link', { name: /^Reels for Maya/ })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/\/templates\/folders\//);
    await expect(page.getByText('Nothing in this folder yet.')).toBeVisible();
    await rail.getByRole('link', { name: /^All templates/ }).click();
    // The trend date is a filter pill like the others; its menu says what "stale" means (UX1).
    await page.getByRole('button', { name: 'Trend', exact: true }).click();
    await expect(page.getByRole('menu')).toContainText('A trend date over 90 days old');
    await page.getByRole('menuitemradio', { name: 'May be stale' }).click();
    await expect(page).toHaveURL(/stale=true/);
    await expect(page.getByRole('button', { name: 'Trend may be stale' })).toBeVisible();
    for (const row of await rows(page).all()) await expect(row).toContainText('Trend may be stale');
    // Back to the folder: a folder is its own history entry.
    await page.goBack();
    await expect(rail.getByRole('link', { name: /^Reels for Maya/ })).toHaveAttribute('aria-current', 'page');
  });

  for (const theme of ['light', 'dark'] as const)
    test(`selecting, in ${theme}: accessible`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, LIBRARY);
      await rows(page).nth(0).locator('[data-slot=row-check]').click();
      await rows(page).nth(2).locator('[data-slot=row-check]').click();
      const bar = page.getByRole('toolbar', { name: 'Selected templates' });
      await expect(bar).toBeVisible();
      await expectAccessible(page, testInfo, `template library (${theme})`);
      if (SCREENS) await page.screenshot({ path: `${SCREENS}/library-selecting-${theme}.png` });
      // P3-R2: the states behind the bar's buttons.
      await bar.getByRole('button', { name: 'Tag…' }).click();
      await expect(page.getByRole('dialog', { name: 'Tag 2 templates' })).toBeVisible();
      await expectAccessible(page, testInfo, `template library, tag dialog (${theme})`);
      await page.keyboard.press('Escape');
      await bar.getByRole('button', { name: 'Move to…' }).click();
      await expect(page.getByRole('menuitem', { name: 'Client work' })).toBeVisible();
      await expectAccessible(page, testInfo, `template library, move menu (${theme})`);
      await page.keyboard.press('Escape');
    });

  test('en-XA: every string is in the catalogue and nothing is clipped', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await open(page, LIBRARY);
    await expect(rows(page).first()).toBeVisible();
    await rows(page).nth(0).locator('[data-slot=row-check]').click();
    await expect(page.locator('[data-slot=bulk-bar]')).toBeVisible();
    // The templates page's own content: the shell's sidebar and window bar have their own en-XA checks.
    await expectPseudoCleanWithin(page, '[data-slot=templates]', 'template library en-XA');
    if (SCREENS) await page.screenshot({ path: `${SCREENS}/library-light-en-XA.png` });
  });
});
