// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a seek costs in the preview player (SPEC G.2): a 60 s preview with captions throughout and two
 * transitions a block, served as main's preview handler serves it, sought 300 times in a fixed random order through the
 * runtime's `__player.seek` (what `<hyperframes-player>` calls). Each seek is timed in the page with the style and
 * layout it causes (a forced layout after it), and the 95th percentile stays under 4 ms.
 */
import type { Server } from 'node:http';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { producerRuntimeScript } from '../../src/engine/producer';
import { tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { serveDir, writeMotionBundle } from './page-support';
import { motionTimeline } from './support';

const shell = findTestShell('motion seek cost');

const SEEKS = 300;
const P95_MS = 4;

/**
 * Seeks in a fixed pseudo-random order over `seconds`, each timed with the layout it causes (ms, in order), and the
 * largest gap between where a seek asked for and where the timeline is after it (so the seek is not deferred).
 */
const SEEK_TIMES = (seconds: number) => `(() => {
  const times = [];
  let gap = 0;
  let seed = 11;
  for (let step = 0; step < ${SEEKS}; step++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const t = (seed / 2147483648) * ${seconds};
    const begin = performance.now();
    window.__player.seek(t);
    void document.documentElement.offsetHeight;
    times.push(performance.now() - begin);
    gap = Math.max(gap, Math.abs(window.__timelines.taalcut.time() - t));
  }
  return { times, gap };
})()`;

describe.skipIf(!shell.path)('preview seek cost (SPEC G.2)', { timeout: 600_000 }, () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let browser: Browser;
  let server: Server;
  let url = '';
  let seconds = 0;

  beforeAll(async () => {
    work = await tempDir('motion-seek');
    const { timeline } = await motionTimeline(3);
    const bundle = await writeMotionBundle(timeline, join(work.dir, 'preview'), 'preview', {
      runtimeScript: { file: await producerRuntimeScript(), key: 'runtime' },
    });
    seconds = bundle.durationFrames / 30;
    ({ server, url } = await serveDir(join(work.dir, 'preview')));
    browser = await puppeteer.launch({ executablePath: shell.path, headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    server?.close();
    await work?.dispose();
  });

  it(`seeks in under ${P95_MS} ms at the 95th percentile`, async () => {
    expect(seconds).toBe(60);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setViewport({ width: 1080, height: 1920 });
    await page.goto(url);
    await page.waitForFunction(
      'Boolean(window.__playerReady && window.__player && window.__timelines.taalcut)',
      {
        timeout: 30_000,
      },
    );
    // A warm-up pass (the first seeks compile style rules), then the measured one.
    await page.evaluate(SEEK_TIMES(seconds));
    const measured = (await page.evaluate(SEEK_TIMES(seconds))) as { times: number[]; gap: number };
    // Each seek moved the timeline there and then (to the frame it falls in).
    expect(measured.gap).toBeLessThanOrEqual(1 / 30);
    const times = [...measured.times].sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    const median = times[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY;
    process.stdout.write(
      `[seek cost] ${SEEKS} seeks over ${seconds} s: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, ` +
        `max ${(times[times.length - 1] ?? 0).toFixed(2)} ms\n`,
    );
    expect(errors).toEqual([]);
    expect(p95).toBeLessThan(P95_MS);
  });
});
