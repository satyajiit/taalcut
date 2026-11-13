// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The Make surfaces' motion (DESIGN.md "Motion"; Hallmark's motion budget): the frames while the export
// dialog moves to its next step, while exports' bars move on, and while the cast board swaps a clip
// (the frame glides to its new place). Each is timed with rAF; the numbers are attached to the report.
// Run headed on the 120 Hz Mac for the release figures (renderer SPEC, "Built: the Make surfaces").
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fakeChat, open, preferences } from './support.ts';

interface FrameReport {
  idle: number;
  median: number;
  p95: number;
  worst: number;
  dropped: number;
  frames: number;
  longTasks: number;
}

/** Starts timing frames in the page; the returned function stops and reports. */
async function timeFrames(page: Page, act: () => Promise<void>, ms: number): Promise<FrameReport> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __frames: { deltas: number[]; idle: number; longTasks: number; stop: boolean };
    };
    w.__frames = { deltas: [], idle: 0, longTasks: 0, stop: false };
    const observer = new PerformanceObserver((list) => (w.__frames.longTasks += list.getEntries().length));
    observer.observe({ type: 'longtask', buffered: false });
    const idle: number[] = [];
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      if (idle.length < 30) idle.push(delta);
      else w.__frames.deltas.push(delta);
      if (idle.length === 30 && w.__frames.idle === 0) w.__frames.idle = [...idle].sort((a, b) => a - b)[15]!;
      if (!w.__frames.stop) requestAnimationFrame(tick);
      else observer.disconnect();
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(400);
  await act();
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const w = window as unknown as {
      __frames: { deltas: number[]; idle: number; longTasks: number; stop: boolean };
    };
    w.__frames.stop = true;
    const { deltas, idle, longTasks } = w.__frames;
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
    };
  });
}

async function report(testInfo: TestInfo, name: string, frames: FrameReport) {
  testInfo.annotations.push({ type: `${name} frame times (ms)`, description: JSON.stringify(frames) });
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(frames, null, 2),
    contentType: 'application/json',
  });
  // The bar the library grid keeps: the 95th percentile within a frame and a half of the display's interval.
  expect(frames.p95, `${name}: ${JSON.stringify(frames)}`).toBeLessThanOrEqual(frames.idle * 1.5 + 1);
}

test.describe('Make motion', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
  });

  test('the export dialog opens and moves on to the export', async ({ page }, testInfo) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 120 });
    await open(page, { name: 'renders', path: '/renders' });
    const ready = page.locator('[data-slot=render-row][data-status=ready]').first();
    const openDialog = async () => {
      await ready.getByRole('button', { name: 'Export again' }).click();
      await page.getByRole('menuitem', { name: 'More options…' }).click();
      await expect(page.locator('[data-slot=export-form]')).toBeVisible();
    };
    // Once before timing: the fake paints its stand-in poster on a canvas (main-thread work the app,
    // loading app://media, never does), and caches it.
    await openDialog();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot=export-dialog]')).toHaveCount(0);
    const frames = await timeFrames(
      page,
      async () => {
        await openDialog();
        await page.getByRole('radio', { name: /TikTok/ }).click();
        // Straight to the summary from the stepper (UX4), then Export.
        await page.locator('[data-slot=export-stepper] button[data-step=summary]').click();
        await page.getByRole('button', { name: 'Export for TikTok' }).click();
        await expect(page.locator('[data-slot=export-dialog] [data-slot=render-progress]')).toBeVisible();
      },
      1200,
    );
    await report(testInfo, 'export-dialog', frames);
  });

  test('exports’ bars move on while the list stays still', async ({ page }, testInfo) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 60 });
    await open(page, { name: 'renders', path: '/renders' });
    // The posters first (the fake paints them on the main thread), then the bars alone.
    await page.waitForTimeout(1500);
    const frames = await timeFrames(page, async () => undefined, 2500);
    await report(testInfo, 'render-progress', frames);
  });

  test('the cast board swaps a clip in place', async ({ page }, testInfo) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 0 });
    await open(page, { name: 'dev-kit', path: '/dev/kit' });
    const board = page.locator('[data-slot=make-cards-gallery] [data-fixture="castBoard/cast"]');
    await board.scrollIntoViewIfNeeded();
    const swap = board.locator('[data-alternate]').first();
    await expect(swap).toBeVisible();
    const frames = await timeFrames(page, () => swap.click(), 900);
    await report(testInfo, 'cast-swap', frames);
  });
});
