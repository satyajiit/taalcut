// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shell's motion in the real app, timed (DESIGN.md, "Window", the fold;
 * "Theme engine", the day/night scene): the sidebar folds and opens ten times
 * each on an empty chat and on a long one (240 messages on screen), and the
 * theme flips ten times on each; every frame from the click on is timed in
 * the page (requestAnimationFrame) and in the compositor (Chromium's frame
 * reporter, frame-timing.ts). The fold must start moving in the frame after
 * the click and neither may drop frames: by default the fold within 2 frames
 * and p95 within 2 refreshes (one stalled frame on a busy machine is not the
 * app's); with TAALCUT_FRAME_BUDGET=strict, on a quiet machine, the
 * fold in the next frame, p95 within a millisecond of the refresh, no frame
 * over 16.7 ms and no frame dropped while anything moves; with
 * TAALCUT_FRAME_BUDGET=measure, no checks, only the numbers. The numbers land
 * in test-results/window-motion/*.json.
 *
 *   pnpm --filter @taalcut/desktop e2e:gate   (builds the renderer and the test build, then this)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type CDPSession, type ElectronApplication, type Page } from '@playwright/test';
import { traceCompositor } from './compositor-trace';
import {
  addPresented,
  clickFrames,
  frameStats,
  type ClickFrames,
  type PresentedFrames,
} from './frame-timing';
import { desktopDir, launchElectron } from './launch';
import { seedConversation } from './library-seed';
import { openSidebar, SIDEBAR_TOGGLE } from './sidebar';

const RESULTS = join(desktopDir, 'test-results', 'window-motion');
const STRICT = process.env.TAALCUT_FRAME_BUDGET === 'strict';
// Only measure (for a before-and-after table): write the numbers, check nothing.
const MEASURE_ONLY = process.env.TAALCUT_FRAME_BUDGET === 'measure';
const ROUNDS = Number(process.env.TAALCUT_FRAME_ROUNDS ?? 10);
const LONG_CHAT = 'A long chat';
const TOGGLE = SIDEBAR_TOGGLE;
const TITLE = '[data-slot=window-bar-title]';
const THEME = '[data-slot=sidebar] [data-slot=theme-toggle]';
// The scene's length (SCENE_MS) and a little after.
const SCENE_WINDOW_MS = 840 + 120;

let app: ElectronApplication;
let page: Page;
let trace: CDPSession;
let userData: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-motion-'));
  // 480 stored messages; the 240 of yours are on screen (the agent's answers replay from run logs, not seeded here).
  await seedConversation(userData, LONG_CHAT, 480);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  app = await launchElectron(userData, { env, colorScheme: null });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // The rounds start from an open sidebar, with the long chat in its list: a window on a small display opens on the
  // rail (sidebar.ts), and the button opens it there as anywhere.
  await openSidebar(page, 30_000);
  // In front and focused, so the window draws at the display's own rate.
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.show();
    win?.moveTop();
    electronApp.focus({ steal: true });
    win?.focus();
    win?.emit('focus');
  });
  mkdirSync(RESULTS, { recursive: true });
  // Tracing's first start is slow in every process: get it out of the way before anything is timed.
  trace = await page.context().newCDPSession(page);
  await traceCompositor(trace, async () => undefined);
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (userData) rmSync(userData, { recursive: true, force: true });
});

interface Clicks {
  readonly frames: ClickFrames[];
  readonly presented: PresentedFrames[];
}

/** One click: its frames timed in the page and traced in the compositor. */
async function tracedClick(
  into: Clicks,
  target = TOGGLE,
  probe: string | null = TITLE,
  windowMs = 400,
): Promise<void> {
  const result = await traceCompositor(trace, () => clickFrames(page, target, probe, windowMs));
  into.frames.push(result.value);
  into.presented.push(result.presented);
}

/** Folds and opens the sidebar ROUNDS times each. */
async function foldRounds(): Promise<{ close: Clicks; open: Clicks }> {
  const close: Clicks = { frames: [], presented: [] };
  const open: Clicks = { frames: [], presented: [] };
  await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'true');
  for (let round = 0; round < ROUNDS; round += 1) {
    await tracedClick(close);
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(300);
    await tracedClick(open);
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(300);
  }
  return { close, open };
}

/** Flips the theme ROUNDS times with the sidebar's toggle, waiting for each scene to end. */
async function themeRounds(): Promise<{ nightfall: Clicks; daybreak: Clicks }> {
  const nightfall: Clicks = { frames: [], presented: [] };
  const daybreak: Clicks = { frames: [], presented: [] };
  // One flip each way first, untimed: the scene's art and the view transition's first use.
  for (let warm = 0; warm < 2; warm += 1) {
    await page.locator(THEME).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', /.*/);
  }
  for (let round = 0; round < ROUNDS; round += 1) {
    const dark = (await page.locator(THEME).getAttribute('data-theme-now')) === 'dark';
    await tracedClick(dark ? daybreak : nightfall, THEME, null, SCENE_WINDOW_MS);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', /.*/);
    await page.waitForTimeout(300);
  }
  return { nightfall, daybreak };
}

/**
 * A view transition holds the old picture while it takes the new one: one
 * long gap in the first frames, with nothing moving. Split off, so the
 * scene's own frames are judged on their own. The picture can only be held
 * from the click on, so the first interval counts from the click, not from
 * the frame before it: a click whose timer ran late on a busy machine is not
 * a picture the app held (IX3-F2).
 */
function splitCapture(samples: readonly ClickFrames[]): { capture: number[]; scene: ClickFrames[] } {
  const capture: number[] = [];
  const scene: ClickFrames[] = [];
  for (const sample of samples) {
    const [first = 0, ...rest] = sample.intervals.slice(0, 3);
    const head = [Math.min(first, sample.clickToFirstFrameMs), ...rest];
    const gap = Math.max(...head);
    capture.push(Math.round(gap * 10) / 10);
    scene.push({ ...sample, intervals: sample.intervals.slice(head.indexOf(gap) + 1) });
  }
  return { capture: capture.sort((a, b) => a - b), scene };
}

function check(label: string, clicks: Clicks, moves = true) {
  const split = moves ? null : splitCapture(clicks.frames);
  const samples = split?.scene ?? clicks.frames;
  const stats = frameStats(samples);
  const capture = split
    ? { median: split.capture[Math.floor(split.capture.length / 2)], max: split.capture.at(-1) }
    : undefined;
  const presented = addPresented(clicks.presented);
  const refresh = samples[0]?.refreshMs ?? 16.7;
  writeFileSync(
    join(RESULTS, `${label}.json`),
    JSON.stringify({ label, refresh, stats, capture, presented, samples: clicks.frames }, null, 2),
  );
  // The numbers, in the run's output as well as the file.
  const held = capture ? ` capture ${JSON.stringify(capture)}` : '';
  process.stdout.write(
    `${label}: refresh ${refresh.toFixed(1)} ms ${JSON.stringify(stats)}${held} ${JSON.stringify(presented)}\n`,
  );
  if (MEASURE_ONLY) return;
  expect(presented.animated, `${label}: compositor animation trace is present`).toBeGreaterThan(0);
  if (moves) {
    expect(stats.worstFirstMove, `${label}: the fold starts moving at once`).not.toBeNull();
    expect(stats.worstFirstMove ?? 99, `${label}: first moving frame`).toBeLessThanOrEqual(STRICT ? 1 : 2);
  }
  if (STRICT) {
    expect(stats.p95, `${label}: p95 frame`).toBeLessThanOrEqual(refresh + 1);
    expect(stats.max, `${label}: longest frame`).toBeLessThanOrEqual(16.7);
    expect(presented.droppedMoving, `${label}: frames dropped while it moves`).toBe(0);
  } else {
    // By default p95, not the longest frame: on a shared, busy machine one frame can stall for
    // reasons outside the app, and that single frame must not fail the run. A real stutter
    // (a fold that waits or a page that re-renders every frame) moves p95. Strict mode, on a
    // quiet machine, checks the longest frame and dropped frames as well.
    expect(stats.p95, `${label}: p95 frame`).toBeLessThanOrEqual(refresh * 2 + 1);
  }
  // The held picture: at most a few frames before the scene moves.
  if (capture)
    expect(capture.max ?? 0, `${label}: the old picture held`).toBeLessThanOrEqual(STRICT ? 50 : 100);
}

test('the sidebar folds and opens without waiting or dropping frames, on an empty chat', async () => {
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
  const { close, open } = await foldRounds();
  check('empty-close', close);
  check('empty-open', open);
});

test('and on a long chat (240 messages on screen)', async () => {
  await page.getByRole('link', { name: LONG_CHAT }).click();
  await expect(page.locator('main').getByText('Cut 479:')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('main article')).toHaveCount(240);
  const { close, open } = await foldRounds();
  check('long-close', close);
  check('long-open', open);
});

test('the day/night scene, on an empty chat and on a long one', async () => {
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
  const empty = await themeRounds();
  check('scene-empty-nightfall', empty.nightfall, false);
  check('scene-empty-daybreak', empty.daybreak, false);
  await page.getByRole('link', { name: LONG_CHAT }).click();
  await expect(page.locator('main article')).toHaveCount(240, { timeout: 15_000 });
  const long = await themeRounds();
  check('scene-long-nightfall', long.nightfall, false);
  check('scene-long-daybreak', long.daybreak, false);
});
