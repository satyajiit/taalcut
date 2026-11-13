// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { primitivesBody } from './fixtures/primitives';

/**
 * The WEB2 primitives on a Playwright-only page (test/e2e/fixtures/primitives.tsx), served at an address the site
 * doesn't have, on its origin, with the built site's stylesheets and font classes taken from out/index.html.
 * FOUNDATION_CAPTURE=1 also writes the review screenshots to .impeccable/review/foundation/.
 */
const FIXTURE = '/__fixtures/primitives/';
const built = readFileSync(fileURLToPath(new URL('../../out/index.html', import.meta.url)), 'utf8');
const htmlClass = /<html[^>]*class="([^"]*)"/.exec(built)?.[1] ?? '';
const styles = [...built.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]).join('\n');
const body = primitivesBody();

function page(theme: 'light' | 'dark'): string {
  return `<!doctype html><html lang="en" class="${htmlClass}" data-theme="${theme}" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Taalcut primitives fixture</title>${styles}</head><body class="min-h-dvh bg-canvas text-ink">${body}</body></html>`;
}

async function open(p: Page, theme: 'light' | 'dark') {
  await p.route(`**${FIXTURE}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: page(theme) }));
  await p.goto(FIXTURE);
  await p.evaluate(() => document.fonts.ready);
}

test('every primitive renders, labelled for assistive technology', async ({ page: p }) => {
  await open(p, 'light');
  await expect(p.getByRole('group', { name: 'A demonstration of the Taalcut app: Remix a reel' }).first()).toBeVisible();
  await expect(p.getByRole('img', { name: /^Template: 13 slots \(Hook 1, Build 2 to / }).first()).toBeVisible();
  await expect(p.getByRole('button', { name: 'Play the reel' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 2, name: 'Every primitive, in this world' })).toBeVisible();
  await expect(p.locator('[data-slot="sticker"]').filter({ hasText: '23 music beats' })).toBeVisible();
  for (const name of ['GitHub', 'Apple', 'Gemini']) await expect(p.getByRole('img', { name, exact: true })).toBeVisible();
  // Kaatu is decoration: hidden from assistive technology and out of the tab order.
  const kaatu = p.locator('[data-slot="kaatu"]');
  await expect(kaatu.first()).toHaveAttribute('aria-hidden', 'true');
  expect(await kaatu.evaluateAll((els) => els.filter((e) => e.hasAttribute('tabindex')).length)).toBe(0);
  // The reel's control is at least 24 px (WCAG 2.5.8).
  const control = await p.getByRole('button', { name: 'Play the reel' }).boundingBox();
  expect(Math.min(control?.width ?? 0, control?.height ?? 0)).toBeGreaterThanOrEqual(24);
});

test('the app window scales as one unit below its design width', async ({ page: p }) => {
  await open(p, 'light');
  const box = p.locator('[data-fixture-box="320"]');
  const m = await box.evaluate((el) => {
    const frame = el.querySelector('[data-slot="app-window-frame"]') as HTMLElement;
    const sidebar = el.querySelector('[data-slot="app-window-sidebar"]') as HTMLElement;
    const bar = el.querySelector('[data-slot="app-window-bar"]') as HTMLElement;
    return {
      frame: frame.getBoundingClientRect().width,
      sidebar: sidebar.getBoundingClientRect().width,
      bar: bar.getBoundingClientRect().height,
      overflow: frame.scrollWidth - frame.clientWidth,
    };
  });
  const scale = 320 / 760;
  expect(m.frame).toBeCloseTo(320, 0);
  expect(m.sidebar).toBeCloseTo(200 * scale, 0);
  expect(m.bar).toBeCloseTo(52 * scale, 0);
  expect(m.overflow).toBeLessThanOrEqual(0);
  // At its design width or wider it is drawn at 1:1.
  const full = await p.locator('[data-slot="app-window"]').first().evaluate((el) => (el.querySelector('[data-slot="app-window-sidebar"]') as HTMLElement).getBoundingClientRect().width);
  expect(full).toBeCloseTo(200, 0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the world's ground and ink hold in ${theme}`, async ({ page: p }) => {
    await open(p, theme);
    // Painted on a canvas, so the check reads sRGB whatever notation the stylesheet keeps the colour in.
    const colours = await p.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      const rgb = (c: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const body = getComputedStyle(document.body);
      return { canvas: rgb(body.backgroundColor), ink: rgb(body.color) };
    });
    if (theme === 'light') {
      expect(colours.canvas).toEqual([255, 255, 255]);
      for (const c of colours.ink) expect(c).toBeLessThan(40);
    } else {
      for (const c of colours.canvas) expect(c).toBeLessThan(16);
      for (const c of colours.ink) expect(c).toBeGreaterThan(235);
    }
    expect(colours.ink).not.toBe(colours.canvas);
  });
}

test('captures the review screenshots', async ({ browser }) => {
  test.skip(!process.env.FOUNDATION_CAPTURE, 'Set FOUNDATION_CAPTURE=1 to write the review screenshots');
  const dir = fileURLToPath(new URL('../../.impeccable/review/foundation/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      const p = await context.newPage();
      await open(p, theme);
      await p.waitForTimeout(800);
      await p.screenshot({ path: `${dir}primitives-${width}-${theme}.png`, fullPage: true });
      await context.close();
    }
  }
});
