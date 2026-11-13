// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The HyperFrames fixtures folded (HFW1 hf): each of the twelve, gated, lowered and folded into a still timeline,
 * draws what HyperFrames' own render of the composition (mounted with data-composition-src, its script run by real
 * GSAP) draws, within 2/255 on every sampled frame, offline. `TAALCUT_FOLD_REPORT` names a file for the numbers,
 * `TAALCUT_FIXTURE_SHOTS` a folder for the frames that differ.
 *
 * One allowance: at most `STRAY.pixels` single pixels a frame may step up to `STRAY.limit`. They are Chrome's partial
 * repaint, not the fold: a moving rounded shape's antialiasing bleeds one pixel past its box, and whether that pixel
 * is repainted or left from an earlier frame depends on the seek history. Sought fresh to the same frames, both pages
 * draw those pixels alike (HFW1 hf report: stagger-list's (119, 690) bleeds in both at frame 46 and in neither at 92).
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import { openCaptureSession, type CaptureHandle } from '../../src/engine/capture';
import { gsapFilesFor } from '../../src/motion/gsap-files';
import { findTestMedia, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { writeMotionBundle } from '../motion/page-support';
import { HF_FIXTURES } from './fixture-list';
import { writeReferenceProject } from './hf-reference';
import { decodePng, frameDifference } from './pixels';
import { FIXTURES, gatedFixture, placement, stillTimeline } from './support';

const media = await findTestMedia('workspace fixtures');
const shell = findTestShell('workspace fixtures');
const LIMIT = 2;
const STRAY = { pixels: 8, limit: 8 } as const;
const SAMPLES_PER_FIXTURE = 14;

describe.skipIf(!media.binaries || !shell.path)(
  'the HyperFrames fixtures folded, against HyperFrames’ own render',
  { timeout: 1_200_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    const blocked: string[] = [];
    const open: CaptureHandle[] = [];
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
      open.push(opened);
      return opened;
    };

    beforeAll(async () => {
      work = await tempDir('workspace-fixtures');
    });
    afterAll(async () => {
      for (const handle of open) await handle.close();
      await work?.dispose();
    });

    it.each(HF_FIXTURES)('%s draws as HyperFrames draws it, within 2/255', async (name) => {
      const composition = await gatedFixture(`${name}.html`);
      const frames = Math.round(composition.doc.durationSeconds * 30);
      const dir = join(work.dir, name);
      await mkdir(dir, { recursive: true });
      await writeMotionBundle(stillTimeline(frames), join(dir, 'export'), 'export', {
        compositions: [placement(composition, { start: 0, end: frames })],
        burnCaptions: false,
      });
      await writeReferenceProject({
        dir: join(dir, 'reference'),
        compositionId: composition.doc.compositionId,
        fixture: join(FIXTURES, `${name}.html`),
        seconds: composition.doc.durationSeconds,
        fonts: composition.fonts,
        gsap: gsapFilesFor({ tweens: composition.motion.tweens, splits: composition.motion.splits }),
        background: '#3a6ea5',
      });
      const exported = await session(join(dir, 'export'));
      const reference = await session(join(dir, 'reference'));
      const samples = Array.from({ length: SAMPLES_PER_FIXTURE }, (_, index) =>
        Math.min(frames - 1, Math.round((index * (frames - 1)) / (SAMPLES_PER_FIXTURE - 1))),
      );
      const report: string[] = [];
      const failed: string[] = [];
      for (const frame of samples) {
        const oursPng = unwrap(await exported.screenshot(frame));
        const theirsPng = unwrap(await reference.screenshot(frame));
        const difference = frameDifference(decodePng(oursPng), decodePng(theirsPng), LIMIT);
        const shots = process.env.TAALCUT_FIXTURE_SHOTS;
        if (shots && difference.max > LIMIT) {
          await writeFile(join(shots, `${name}-${frame}-ours.png`), oursPng);
          await writeFile(join(shots, `${name}-${frame}-theirs.png`), theirsPng);
        }
        const line = `${name} frame ${frame}: max ${difference.max}, ${difference.pixelsOver} pixels over ${LIMIT}`;
        report.push(line);
        const stray = difference.max <= STRAY.limit && difference.pixelsOver <= STRAY.pixels;
        if (difference.max > LIMIT && !stray) failed.push(line);
      }
      if (process.env.TAALCUT_FOLD_REPORT)
        await appendFile(process.env.TAALCUT_FOLD_REPORT, `${report.join('\n')}\n`);
      for (const handle of [exported, reference]) {
        open.splice(open.indexOf(handle), 1);
        await handle.close();
      }
      expect(failed, report.join('\n')).toEqual([]);
      expect(blocked).toEqual([]);
    });
  },
);
