// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { CLIP } from './routes.ts';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

/** The fake library's options (src/backend/fake/expose.ts), set before the app starts. */
async function fakeLibrary(page: Page, options: Record<string, unknown>): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify(options),
  });
}

const LIBRARY = { name: 'library', path: '/library' };
const tiles = (page: Page) => page.locator('[data-slot=clip-tile]');

interface FrameReport {
  /** The display's frame interval with nothing moving, ms (8.3 on a 120 Hz screen, 16.7 on 60 Hz). */
  idle: number;
  median: number;
  p95: number;
  worst: number;
  /** Frames that took longer than 1.5 intervals. */
  dropped: number;
  frames: number;
  longTasks: number;
  tilesInDom: number;
}

/**
 * Scrolls the main area through the grid at a steady speed for `ms`, one step
 * per frame (as a trackpad fling does), and times every frame with rAF. Long
 * tasks (over 50 ms on the main thread) are counted too.
 */
async function scrollFrames(page: Page, ms: number, pxPerFrame: number): Promise<FrameReport> {
  return page.evaluate(
    async ({ ms, pxPerFrame }) => {
      const scroller = document.querySelector<HTMLElement>('[data-slot=scroll-area]')!;
      const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      let longTasks = 0;
      const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask', buffered: false });

      const idleDeltas: number[] = [];
      let last = await nextFrame();
      for (let i = 0; i < 60; i += 1) {
        const now = await nextFrame();
        idleDeltas.push(now - last);
        last = now;
      }
      idleDeltas.sort((a, b) => a - b);
      const idle = idleDeltas[Math.floor(idleDeltas.length / 2)]!;

      // Every pass starts at the top and goes the same way, so a second pass covers the rows the first loaded.
      scroller.scrollTop = 0;
      await nextFrame();
      const deltas: number[] = [];
      const start = await nextFrame();
      last = start;
      let direction = 1;
      while (last - start < ms) {
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (scroller.scrollTop >= max - pxPerFrame) direction = -1;
        if (scroller.scrollTop <= pxPerFrame) direction = 1;
        scroller.scrollTop += direction * pxPerFrame;
        const now = await nextFrame();
        deltas.push(now - last);
        last = now;
      }
      observer.disconnect();
      const sorted = [...deltas].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      return {
        idle,
        median: at(0.5),
        p95: at(0.95),
        worst: sorted[sorted.length - 1]!,
        dropped: deltas.filter((d) => d > idle * 1.5).length,
        frames: deltas.length,
        longTasks,
        tilesInDom: document.querySelectorAll('[data-slot=clip-tile]').length,
      };
    },
    { ms, pxPerFrame },
  );
}

test.describe('library (P2-L11)', () => {
  test('5,000 clips: the grid keeps up with the display while it scrolls', async ({ page }, testInfo) => {
    const problems = await watchProblems(page);
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakeLibrary(page, { library: 5000, indexingTickMs: 0 });
    await open(page, LIBRARY);
    // 5,000 in the library; the few whose files have gone missing are left out unless asked for.
    await expect(page.getByRole('status').filter({ hasText: /^4,9\d\d clips$/ })).toBeVisible();
    await expect(tiles(page).first()).toBeVisible();

    // A first pass loads the pages as the grid reaches them and lets the fake paint its stand-in
    // thumbnails (canvas work on the main thread that the app, reading app://media, never does).
    // The second pass over the same rows is what is timed: rows mounting and unmounting, tiles
    // moving on the compositor.
    await scrollFrames(page, 4_000, 40);
    await expect(page.locator('[data-slot=library] [aria-busy=true]')).toHaveCount(0);
    const report = await scrollFrames(page, 4_000, 40);
    testInfo.annotations.push({ type: 'frame times (ms)', description: JSON.stringify(report) });
    await testInfo.attach('frame-times.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    // Windowed: only the rows on screen (and a few either side) exist, never thousands.
    expect(report.tilesInDom).toBeLessThan(200);
    // Every frame on time but a few: the 95th percentile within a frame and a half of the display's interval.
    expect(report.p95, JSON.stringify(report)).toBeLessThanOrEqual(report.idle * 1.5 + 1);
    expect(report.dropped / report.frames, JSON.stringify(report)).toBeLessThan(0.05);
    // Long tasks are reported, not failed on: other workers share the CPU, and a stall that matters shows as dropped frames.
    expect(problems).toEqual([]);
  });

  test('filters narrow the grid and live in the URL; clearing them brings every clip back', async ({
    page,
  }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    const count = page.getByRole('status').filter({ hasText: /clips?$/ });
    const all = (await count.textContent())?.trim() ?? '';
    expect(all).toMatch(/^4,9\d\d clips$/);
    await page.getByRole('button', { name: /^Shape/ }).click();
    await page.getByRole('menuitemradio', { name: 'Horizontal' }).click();
    await expect(page).toHaveURL(/shape=landscape/);
    await expect(count).not.toHaveText(all);
    await expect(page.locator('[data-slot=filter-pill][data-set]')).toHaveText(/Horizontal/);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page).not.toHaveURL(/shape=/);
    await expect(count).toHaveText(all);
  });

  test('while the clips are counted a still bone holds the count’s place, so nothing moves when it lands', async ({
    page,
  }) => {
    // The library's reads wait 1.5 s, so the toolbar is up before the count (audit L1).
    await fakeLibrary(page, { indexingTickMs: 0, libraryLatencyMs: 1500 });
    // Not open(): it waits for the page's loading to end, and this looks at the page while it loads.
    await page.goto(LIBRARY.path);
    const count = page.locator('[data-slot=library-toolbar] [data-slot=clip-count]');
    // The sort, the row's last pill (it shows its choice, "Newest first", not its name).
    const sort = page.locator('[data-slot=library-toolbar] [data-slot=filter-pill]').last();
    await expect(count).toHaveAttribute('aria-busy', 'true');
    await expect(count.locator('.tc-bone')).toHaveCount(1);
    const [counting, sortBefore] = [await count.boundingBox(), await sort.boundingBox()];
    await expect(count).toHaveText(/^4,9\d\d clips$/);
    await expect(count).toHaveAttribute('aria-busy', 'false');
    await expect(count.locator('.tc-bone')).toHaveCount(0);
    await expect(count).toHaveCSS('font-variant-numeric', 'tabular-nums');
    const [counted, sortAfter] = [await count.boundingBox(), await sort.boundingBox()];
    // The Sort pill and the row stay put; the number takes about the bone's width.
    expect(sortAfter).toEqual(sortBefore);
    expect(counted?.y).toBe(counting?.y);
    expect(Math.abs((counted?.width ?? 0) - (counting?.width ?? 0))).toBeLessThanOrEqual(8);
  });

  test('a library with no trips, places or activities holds as still: its pills are there from the start', async ({
    page,
  }) => {
    // LIB1-FIND: the Trip, Place and Activity reads answer nothing. The pills stay in the row and their menus say how
    // they fill, so nothing in the toolbar moves when the reads land (audit L1).
    await fakeLibrary(page, { indexingTickMs: 0, libraryLatencyMs: 1500, places: 'none', actions: 'none' });
    await page.goto(LIBRARY.path);
    const toolbar = page.locator('[data-slot=library-toolbar]');
    const count = toolbar.locator('[data-slot=clip-count]');
    const pills = toolbar.locator('[data-slot=filter-pill]');
    const boxes = () =>
      pills.evaluateAll((all) =>
        all.map((pill) => {
          const { x, y, width } = pill.getBoundingClientRect();
          return { text: pill.textContent, x, y, width };
        }),
      );
    await expect(count).toHaveAttribute('aria-busy', 'true');
    const [counting, before] = [await count.boundingBox(), await boxes()];
    await expect(count).toHaveText(/^4,9\d\d clips$/);
    // The Activity read waits as long as the count; its menu saying it has nothing means it has landed.
    await pills.filter({ hasText: /^Activity$/ }).click();
    await expect(page.locator('[data-slot=filter-empty]')).toHaveText(/^Nothing yet\./);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(before.map((pill) => pill.text)).toEqual(expect.arrayContaining(['Trip', 'Place', 'Activity']));
    expect(await boxes()).toEqual(before);
    const counted = await count.boundingBox();
    expect(counted?.y).toBe(counting?.y);
    expect(Math.abs((counted?.width ?? 0) - (counting?.width ?? 0))).toBeLessThanOrEqual(8);
  });

  test('search finds shots by what is said or seen; Find similar shows shots like one', async ({ page }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    const field = page.getByRole('searchbox', { name: 'Search your clips' });
    await field.fill('chai');
    await field.press('Enter');
    await expect(page).toHaveURL(/q=chai/);
    const hits = page.locator('[data-slot=search-hit]');
    await expect(hits.first()).toBeVisible();
    await hits.first().getByRole('button', { name: 'Find similar' }).click();
    await expect(page).toHaveURL(/similar=/);
    await expect(page.getByRole('status').filter({ hasText: /look like this one/ })).toBeVisible();
    await page.getByRole('button', { name: 'Back to all clips' }).click();
    await expect(tiles(page).first()).toBeVisible();
  });

  test('no matches says so and offers to clear', async ({ page }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    const field = page.getByRole('searchbox', { name: 'Search your clips' });
    await field.fill('zzqx nothing like this');
    await field.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'No clips match' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).last().click();
    await expect(page).not.toHaveURL(/q=/);
  });

  test('an empty library is the drop zone, with the phone beside it', async ({ page }) => {
    await fakeLibrary(page, { library: 'empty' });
    await open(page, LIBRARY);
    await expect(page.getByRole('region', { name: 'Drop a folder of videos here' })).toBeVisible();
    await page.getByRole('link', { name: 'Connect your phone' }).click();
    await expect(page).toHaveURL(/\/library\/phone\/wifi$/);
  });

  test('the grid is one tab stop; arrows move between clips and Enter opens one', async ({ page }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    const first = tiles(page).first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tiles(page).nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/library\/[0-9A-Z]{26}$/);
    await expect(page.locator('[data-slot=clip-facts]')).toBeVisible();
  });

  test('opening a clip grows its tile’s frame into the viewer, and going back shrinks it into the tile (UX2)', async ({
    page,
  }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    const first = tiles(page).first();
    const id = /\/library\/([0-9A-Z]{26})$/.exec((await first.getAttribute('href')) ?? '')?.[1];
    /** The view-transition animations the window runs from now on, by the pseudo-element each moves. */
    const watch = () =>
      page.evaluate(() => {
        const seen: string[] = [];
        Object.assign(window, { seenTransitions: seen });
        const started = performance.now();
        const look = () => {
          for (const animation of document.getAnimations()) {
            const effect = animation.effect;
            const target = effect instanceof KeyframeEffect ? effect.pseudoElement : null;
            if (target && !seen.includes(target)) seen.push(target);
          }
          if (performance.now() - started < 3000) requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
    const seen = () => page.evaluate(() => Reflect.get(window, 'seenTransitions'));
    const frameMoved = `::view-transition-group(clip-${id})`;

    await watch();
    await first.click();
    await expect(page.locator('[data-slot=clip-frame]')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-clip-moving');
    expect(await seen()).toContain(frameMoved);

    await watch();
    await page.goBack();
    await expect(tiles(page).first()).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-clip-moving');
    expect(await seen()).toContain(frameMoved);
    // The tile lets the name go once it has moved, so the next clip opened is the only frame that moves.
    await expect
      .poll(() =>
        tiles(page)
          .first()
          .locator('span')
          .first()
          .evaluate((frame) => frame.style.viewTransitionName),
      )
      .toBe('');
  });

  test('a clip: profile, shots and what is said; choosing a shot marks its words', async ({ page }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, { name: 'library-asset', path: `/library/${CLIP}` });
    await expect(page.locator('h1')).toContainText('IMG_5264.MOV');
    await expect(page.getByRole('heading', { name: 'What’s said' })).toBeVisible();
    const shots = page.locator('[data-slot=clip-shot]');
    await expect(shots.first()).toHaveAttribute('aria-current', 'true');
    await shots.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(shots.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(shots.nth(1)).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Shot 2' })).toBeVisible();
    await page.getByRole('link', { name: 'Find similar' }).click();
    await expect(page).toHaveURL(/\/library\?similar=/);
  });
});
