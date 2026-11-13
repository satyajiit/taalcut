// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H1 "Done when": switching theme shows no flash on launch.
//
// The test holds back the app's JavaScript, so the only things that can paint
// are index.html, the stylesheet and theme-boot.js. With a stored dark choice
// and a light OS, that first paint must already be the dark canvas. A sampler
// then records the canvas colour on every animation frame from the very first
// one until the app has rendered; no frame may show the other theme.
import { expect, test, type Page } from '@playwright/test';
import {
  CANVAS,
  closeTo,
  hexToRgb,
  pixelOnScreen,
  preferences,
  THEME_STORAGE_KEY,
  toRgb,
} from './support.ts';

declare global {
  interface Window {
    __canvasFrames?: string[];
  }
}

async function sampleEveryFrame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: string[] = [];
    window.__canvasFrames = frames;
    const sample = () => {
      frames.push(getComputedStyle(document.documentElement).backgroundColor);
      if (frames.length < 2000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** Delays every script bundle until release() is called. theme-boot.js is not held. */
async function holdAppBundle(page: Page): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/.+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

/**
 * Every distinct canvas colour the sampler saw. A transparent sample (a frame
 * before the stylesheet applied) resolves to black and so fails the checks too.
 */
async function framesAsRgb(page: Page): Promise<[number, number, number][]> {
  const frames = await page.evaluate(() => window.__canvasFrames ?? []);
  return Promise.all([...new Set(frames)].map((colour) => toRgb(page, colour)));
}

for (const [stored, os] of [
  ['dark', 'light'],
  ['light', 'dark'],
] as const) {
  test(`a stored ${stored} choice paints ${stored} from the first frame on a ${os} OS`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: os });
    await preferences(page, { theme: stored });
    await sampleEveryFrame(page);
    const release = await holdAppBundle(page);

    await page.goto('/library', { waitUntil: 'commit' });
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).backgroundColor !== 'rgba(0, 0, 0, 0)',
    );
    // Before any app code has run.
    expect(await page.locator('#root').evaluate((el) => el.childElementCount)).toBe(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', stored);
    const firstPaint = await pixelOnScreen(page, 20, 20);
    expect(closeTo(firstPaint, hexToRgb(CANVAS[stored])), `first paint ${firstPaint}`).toBe(true);
    // Frames really were drawn while the app was held back.
    expect(await page.evaluate(() => window.__canvasFrames?.length ?? 0)).toBeGreaterThan(0);

    release();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const frames = await framesAsRgb(page);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(closeTo(frame, hexToRgb(CANVAS[os])), `a frame showed the ${os} canvas`).toBe(false);
      expect(closeTo(frame, hexToRgb(CANVAS[stored])), `frame ${frame} is the ${stored} canvas`).toBe(true);
    }
  });
}

test('system follows the OS from the first frame', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const release = await holdAppBundle(page);
  await page.goto('/chat', { waitUntil: 'commit' });
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).backgroundColor !== 'rgba(0, 0, 0, 0)',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(closeTo(await pixelOnScreen(page, 20, 20), hexToRgb(CANVAS.dark))).toBe(true);
  release();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  // The toolbar, top right, is painted with the canvas (top left is the sidebar's band).
  const toolbar = await pixelOnScreen(page, page.viewportSize()!.width - 20, 20);
  expect(closeTo(toolbar, hexToRgb(CANVAS.light), 12)).toBe(true);
});

test('switching to dark in the app is kept, and the next launch starts dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/chat');
  // The sidebar's one theme control flips what you see.
  await page.locator('[data-slot=sidebar]').getByRole('button', { name: 'Switch to dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', /.*/);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');
  // The two-frame transition freeze is lifted again.
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/);

  await sampleEveryFrame(page);
  const release = await holdAppBundle(page);
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).backgroundColor !== 'rgba(0, 0, 0, 0)',
  );
  expect(closeTo(await pixelOnScreen(page, 20, 20), hexToRgb(CANVAS.dark))).toBe(true);
  release();
  await expect(
    page.locator('[data-slot=sidebar]').getByRole('button', { name: 'Switch to light' }),
  ).toBeVisible();
  for (const frame of await framesAsRgb(page)) {
    expect(closeTo(frame, hexToRgb(CANVAS.light)), 'a light frame after relaunch').toBe(false);
  }
});
