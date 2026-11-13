// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real preview's frame rate (P3-R1, v1.0 gate criterion 7: 30 fps preview), in the test build: the make
 * flow's brief journey ("Make a 30 s vlog of my trip", the recorded make-flow session, the seeded trip
 * library) makes a 30 s 1080×1920 timeline; the editor then plays it in render's preview session
 * (`<hyperframes-player>`, app://preview) and perf-frames.ts counts the video frames presented in that frame
 * and the app page's animation frames. App metrics are sampled throughout (app-metrics.ts).
 *
 * Writes $TAALCUT_PERF_DIR/preview.json (tools/evals' `{ medianFps, p5Fps, droppedFrames }`),
 * preview-detail.json and preview-metrics.jsonl. The gate figure is for a 60 s timeline on the M1 8 GB
 * runner; this is a 30 s one on the machine it runs on.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { unwrap } from '@taalcut/core';
import { MAKE_FLOW_BRIEF } from '@taalcut/gate-demo';
import { createBinaryResolver } from '@taalcut/media';
import { libraryPath } from '../src/shared/library-path';
import { sampleAppMetrics, type MetricsSampler } from './app-metrics';
import { launchApp } from './gate-support';
import { desktopDir } from './launch';
import { shellAvailable } from './headless-shell';
import { makeFlowEnv, makeFlowHome, type MakeFlowHome } from './make-flow-support';
import { previewStats, startProbe, stopProbe } from './perf-frames';

const ffmpeg = await createBinaryResolver({ development: true }).resolve();
test.skip(!ffmpeg.ok, 'no FFmpeg build: run tools/ffmpeg/build.sh');
test.skip(!shellAvailable(), "no chrome-headless-shell: run e2e:provision, or render's tests once");

const OUT = process.env.TAALCUT_PERF_DIR ?? join(desktopDir, 'test-results', 'perf');
const FLOW_MS = 600_000;

let app: ElectronApplication;
let page: Page;
let root: string;
let world: MakeFlowHome;
let metrics: MetricsSampler;

interface DraftTimeline {
  readonly id: string;
  readonly projectId: string;
  /** The video frame rate the render and the preview play at. */
  readonly rate: number;
  readonly seconds: number;
}

/** The timeline the journey's passing draft was made from, with its length and the draft's frame rate. */
function draftTimeline(userData: string): DraftTimeline {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT t.id, t.project_id, t.duration_value, t.duration_rate_num, t.duration_rate_den, r.rate_num, r.rate_den
           FROM renders r JOIN timelines t ON t.id = r.timeline_id
          WHERE r.status = 'ready' ORDER BY r.created_at DESC LIMIT 1`,
      )
      .get();
    if (!row) throw new Error('no ready draft');
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      rate: Number(row.rate_num) / Number(row.rate_den),
      seconds: (Number(row.duration_value) * Number(row.duration_rate_den)) / Number(row.duration_rate_num),
    };
  } finally {
    db.close();
  }
}

/** The preview session's frame (app://preview), inside the player's shadow root. */
async function previewFrame(): Promise<Frame> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const frame = page.frames().find((f) => f.url().startsWith('app://preview'));
    if (frame) return frame;
    if (Date.now() > deadline)
      throw new Error(`no app://preview frame: ${page.frames().map((f) => f.url())}`);
    await page.waitForTimeout(200);
  }
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  root = mkdtempSync(join('/tmp', 'taalcut-perf-preview-'));
  world = await makeFlowHome(root, unwrap(ffmpeg));
  app = await launchApp(world.userData, makeFlowEnv(world.home));
  page = await app.firstWindow();
  await page.getByRole('link', { name: 'New chat' }).waitFor({ timeout: 60_000 });
  metrics = sampleAppMetrics(app, join(OUT, 'preview-metrics.jsonl'));
});

test.afterAll(async () => {
  await app?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

test('the editor plays a 30 s timeline in the real preview: video frames presented per second', async () => {
  test.setTimeout(FLOW_MS * 2);
  // The brief journey, up to the one approval: the draft passed QA, so the timeline is complete.
  await page.getByRole('link', { name: 'New chat' }).click();
  const composer = page.getByRole('textbox', { name: 'Message Taalcut' });
  await composer.fill(MAKE_FLOW_BRIEF);
  await composer.press('Enter');
  const ready = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Ready to export' }) })
    .last();
  await expect(ready.getByRole('button', { name: 'Export' })).toBeEnabled({ timeout: FLOW_MS });

  const { id, projectId, rate, seconds } = draftTimeline(world.userData);
  await page.goto(`app://taalcut/projects/${projectId}/timeline?timeline=${id}`);
  await expect(page.locator('[data-slot=preview-player][data-state=ready]')).toBeVisible({
    timeout: 120_000,
  });
  const frame = await previewFrame();

  const load = loadavg();
  await frame.evaluate(startProbe);
  await page.evaluate(startProbe);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(seconds * 1000 + 1500);
  const inFrame = await frame.evaluate(stopProbe);
  const inPage = await page.evaluate(stopProbe);
  const sampled = await metrics.stop();

  const stats = previewStats(inFrame, seconds, rate);
  const appUi = previewStats(inPage, seconds, rate).raf;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'preview.json'),
    `${JSON.stringify({ medianFps: stats.medianFps, p5Fps: stats.p5Fps, droppedFrames: stats.droppedFrames })}\n`,
  );
  const detail = {
    measuredAt: new Date().toISOString(),
    loadAverage: load.map((value) => Math.round(value * 10) / 10),
    timeline: { seconds, rate, width: 1080, height: 1920 },
    preview: stats,
    appPageRaf: appUi,
    metricsSamples: sampled.samples,
  };
  writeFileSync(join(OUT, 'preview-detail.json'), `${JSON.stringify(detail, null, 2)}\n`);
  console.warn(
    `[perf] preview: ${JSON.stringify({ ...detail, preview: { ...stats, fpsPerSecond: undefined } })}`,
  );
  // A measurement, not a gate: it must at least have seen the video play.
  expect(stats.presentedFrames, JSON.stringify(stats)).toBeGreaterThan(0);
});
