// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { RouteSample } from './routes.ts';

export const THEME_STORAGE_KEY = 'taalcut.theme';
export const LOCALE_STORAGE_KEY = 'taalcut.locale';
export const ARTIFACTS = new URL('../e2e-artifacts/', import.meta.url);

/** Canvas colours from the generated tokens (what Electron uses for window backgrounds). */
export const CANVAS: { light: string; dark: string } = JSON.parse(
  readFileSync(new URL('../../../design/tokens/theme-meta.json', import.meta.url), 'utf8'),
).canvas;

/** Stores a theme and/or locale before any page script runs, on every load of this page. */
export async function preferences(
  page: Page,
  prefs: { theme?: 'system' | 'light' | 'dark'; locale?: 'en' | 'hi' | 'es' | 'pt-BR' | 'en-XA' },
): Promise<void> {
  await page.addInitScript(
    ({ prefs, keys }) => {
      if (prefs.theme) window.localStorage.setItem(keys.theme, prefs.theme);
      if (prefs.locale) window.localStorage.setItem(keys.locale, prefs.locale);
    },
    { prefs, keys: { theme: THEME_STORAGE_KEY, locale: LOCALE_STORAGE_KEY } },
  );
}

/**
 * Collects console errors, uncaught exceptions and CSP violations. A violation
 * also arrives as a securitypolicyviolation event, which is logged as an error
 * so nothing is missed even if the browser's own message changes.
 */
export async function watchProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || /content security policy/i.test(text)) {
      problems.push(`console ${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  return problems;
}

/** localStorage key of the fakes' options (src/chat/fake-client.ts, src/backend/fake/expose.ts). */
export const FAKE_OPTIONS_KEY = 'taalcut.fake';

/**
 * Sets the fakes up before the app starts: IPC latency, script speed, failing
 * commands, recovery; and the Phase 2 fakes' library, templates and Wi-Fi
 * import (src/backend/fake/expose.ts phase2OptionsFromStorage).
 */
export async function fakeChat(
  page: Page,
  options: {
    latencyMs?: number;
    speed?: number;
    /** Commands whose dispatch fails. */
    failCommands?: string[];
    /** What the fake recovery client reports at launch. */
    recovery?: 'none' | 'restored' | 'missing' | 'unfinished' | 'everything';
    /** How many clips in the library ('empty': none). Default 5,000. */
    library?: number | 'empty';
    /** No saved templates. */
    templates?: 'empty';
    /** No projects, timelines or exports (the Make fakes). */
    projects?: 'empty';
    /** Milliseconds between an export's progress steps; 0 holds every render still. */
    renderTickMs?: number;
    /** Milliseconds between indexing steps; 0 holds the import still. */
    indexingTickMs?: number;
    /** The Wi-Fi import's scenario (src/backend/fake/fake-transfer.ts). */
    transfer?: string;
    transferSpeed?: number;
    /** 'approval': how long the phone's request waits for an answer (default 60 s). */
    transferApprovalMs?: number;
    /** A run holds still after its first event of this type, until stopped (src/chat/fake-client.ts). */
    holdAfter?: string;
    /** timelines.fitTemplates' scenario (src/backend/fake/make/fake-fit.ts): no searchable clips, or a failed read. */
    fit?: 'noShots' | 'failing';
    /** templates.search's scenario (src/backend/fake/templates/fake-template-search.ts); absent, words only. */
    templateSearch?: 'ready' | 'failing';
    /** EDT1-CMT: three comments on Golden hour market's first video (src/backend/fake/comments/comments-seed.ts). */
    comments?: 'seeded';
  },
): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify(options),
  });
}

/** Opens a route and waits until the page has rendered, fonts included, and every skeleton has gone. */
export async function open(page: Page, route: RouteSample): Promise<void> {
  await page.goto(route.path);
  await expect(page.locator('h1').first()).toBeVisible();
  // Pages that load data show a loading block until it arrives; checks run on the loaded page.
  await expect(
    page.locator('[data-boneyard][aria-busy="true"], [data-slot=global-loader], [data-slot="loading"]'),
  ).toHaveCount(0);
  if (route.lands) await expect(page).toHaveURL(new RegExp(`${route.lands}$`));
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Let the engine's two-frame transition freeze finish.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // The window title is set in an effect, just after the first render.
  await expect.poll(() => page.title()).not.toBe('Taalcut');
}

/**
 * Saves a screenshot of the whole page. The app scrolls inside its main area,
 * not the document, so the window grows to fit that area first.
 */
export async function screenshotWhole(page: Page, file: string): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  const height = await page.evaluate(() => {
    const areas = [...document.querySelectorAll<HTMLElement>('[data-slot=scroll-area]')];
    return Math.max(
      window.innerHeight,
      ...areas.map((el) => el.getBoundingClientRect().top + el.scrollHeight),
    );
  });
  if (height > size.height)
    await page.setViewportSize({ width: size.width, height: Math.min(Math.ceil(height), 4000) });
  await page.screenshot({ path: new URL(file, ARTIFACTS).pathname, animations: 'disabled' });
  await page.setViewportSize(size);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function closeTo(actual: readonly number[], expected: readonly number[], tolerance = 2): boolean {
  return actual.length >= 3 && expected.every((v, i) => Math.abs((actual[i] ?? -999) - v) <= tolerance);
}

/** Resolves any CSS colour (oklch, rgb, …) to sRGB bytes, the way the page would paint it. */
export async function toRgb(page: Page, colour: string): Promise<[number, number, number]> {
  return page.evaluate((value) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, colour);
}

/** The colour actually on screen at a point: a real screenshot, decoded by the browser. */
export async function pixelOnScreen(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, animations: 'disabled' });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, png.toString('base64'));
}
