// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fold, drawn (HFW1 hf day-1 spike): a hand-written HyperFrames sub-composition (a headline split into letters
 * by SplitText, a DrawSVG underline, one paused timeline on window.__timelines) gated, lowered and folded into a
 * test timeline at an item's start and length. Its frames are compared, as PNG, three ways at sampled frames:
 * the export (the producer's capture session, offline) against the preview (HyperFrames' runtime `__player.seek`,
 * served as main serves it), and the fold against HyperFrames' own render of the same file mounted as a
 * sub-composition with its own script and real GSAP. Each must be within 2/255.
 */
import { appendFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import { openCaptureSession, type CaptureHandle } from '../../src/engine/capture';
import { producerRuntimeScript } from '../../src/engine/producer';
import { gsapFilesFor } from '../../src/motion/gsap-files';
import { findTestMedia, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { serveDir, writeMotionBundle } from '../motion/page-support';
import { writeReferenceProject } from './hf-reference';
import { decodePng, frameDifference, type FrameDifference } from './pixels';
import { FIXTURES, gatedFixture, placement, stillTimeline } from './support';

const media = await findTestMedia('workspace fold');
const shell = findTestShell('workspace fold');

const START = 30;
const FRAMES = 120;
/** Before, at the start, across the letters' rise (0.2 s in, 25 ms apart), the underline's draw, rest, the exit. */
const SAMPLES = [
  0, 30, 36, 38, 41, 44, 47, 50, 53, 56, 60, 64, 68, 72, 80, 90, 120, 132, 135, 138, 141, 144, 149, 150, 170,
];
const LIMIT = 2;

/** Where the per-frame numbers go when asked (vitest keeps a passing test's console quiet). */
const record = async (title: string, lines: readonly string[]) => {
  const file = process.env.TAALCUT_FOLD_REPORT;
  if (file) await appendFile(file, `${title}\n${lines.join('\n')}\n`);
};

const summary = (frame: number, difference: FrameDifference) =>
  `frame ${frame}: max ${difference.max}, mean ${difference.mean.toFixed(4)}, over ${(difference.over * 100).toFixed(3)}%`;

describe.skipIf(!media.binaries || !shell.path)(
  'a HyperFrames composition folded into the timeline',
  { timeout: 900_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    let browser: Browser;
    let preview: Page;
    let server: Server;
    const sessions: CaptureHandle[] = [];
    const blocked: string[] = [];

    const session = async (dir: string) => {
      const opened = unwrap(
        await openCaptureSession({
          dir,
          rate: { num: 30, den: 1 },
          width: 1080,
          height: 1920,
          chromePath: shell.path ?? '',
          browserGpu: 'software',
          binaries: { ffmpeg: media.binaries?.ffmpeg ?? '', ffprobe: media.binaries?.ffprobe ?? '' },
          offline: { blocked },
          format: 'png',
        }),
      );
      sessions.push(opened);
      return opened;
    };
    const shot = async (handle: CaptureHandle, frame: number) =>
      decodePng(unwrap(await handle.screenshot(frame)));
    const previewShot = async (frame: number) => {
      await preview.evaluate(`void window.__player.seek(${frame / 30})`);
      await preview.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      return decodePng(Buffer.from(await preview.screenshot({ type: 'png' })));
    };

    let exportDir = '';
    let referenceDir = '';

    beforeAll(async () => {
      work = await tempDir('workspace-fold');
      const composition = await gatedFixture('headline.html');
      const placed = [placement(composition, { start: START, end: START + FRAMES })];
      const timeline = stillTimeline(180);
      exportDir = join(work.dir, 'export');
      await writeMotionBundle(timeline, exportDir, 'export', { compositions: placed, burnCaptions: false });
      const runtime = await producerRuntimeScript();
      await writeMotionBundle(timeline, join(work.dir, 'preview'), 'preview', {
        compositions: placed,
        burnCaptions: false,
        runtimeScript: { file: runtime, key: 'runtime' },
      });
      referenceDir = join(work.dir, 'reference');
      await writeReferenceProject({
        dir: referenceDir,
        compositionId: composition.doc.compositionId,
        fixture: join(FIXTURES, 'headline.html'),
        seconds: composition.doc.durationSeconds,
        fonts: composition.fonts,
        gsap: gsapFilesFor({ tweens: composition.motion.tweens, splits: composition.motion.splits }),
        background: '#3a6ea5',
      });
      let url: string;
      ({ server, url } = await serveDir(join(work.dir, 'preview')));
      browser = await puppeteer.launch({
        executablePath: shell.path,
        headless: true,
        args: ['--font-render-hinting=none'],
      });
      preview = await browser.newPage();
      await preview.setViewport({ width: 1080, height: 1920 });
      await preview.goto(url);
      await preview.waitForFunction(
        'Boolean(window.__playerReady && window.__player && window.__timelines && window.__timelines.taalcut)',
        { timeout: 30_000 },
      );
    });

    afterAll(async () => {
      for (const handle of sessions) await handle.close();
      await browser?.close();
      server?.close();
      await work?.dispose();
    });

    it('the export draws the folded composition as the preview does, within 2/255', async () => {
      const exported = await session(exportDir);
      const report: string[] = [];
      for (const frame of SAMPLES) {
        const difference = frameDifference(await shot(exported, frame), await previewShot(frame), LIMIT);
        report.push(summary(frame, difference));
        if (difference.max > LIMIT) await record('preview against export (failed)', report);
        expect(difference.max, report.at(-1)).toBeLessThanOrEqual(LIMIT);
      }
      await record('preview against export', report);
      expect(blocked).toEqual([]);
    });

    it('the fold draws what HyperFrames’ own render of the composition draws, within 2/255', async () => {
      const [exported] = sessions;
      if (!exported) throw new Error('no export session');
      const reference = await session(referenceDir);
      const report: string[] = [];
      for (const frame of SAMPLES.filter((frame) => frame >= START && frame < START + FRAMES)) {
        const difference = frameDifference(
          await shot(exported, frame),
          await shot(reference, frame - START),
          LIMIT,
        );
        report.push(summary(frame, difference));
        if (difference.max > LIMIT) await record('fold against HyperFrames (failed)', report);
        expect(difference.max, report.at(-1)).toBeLessThanOrEqual(LIMIT);
      }
      await record('fold against HyperFrames', report);
      expect(blocked).toEqual([]);
    });
  },
);
