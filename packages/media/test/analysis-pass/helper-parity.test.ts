// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-V4: the analysis pass on the mac helper's decode gives what FFmpeg's VideoToolbox route gives, on clips
 * the bundled FFmpeg encodes with the platform's software H.264 route: the same frames, black and freeze intervals and cut, gray
 * frames and frame sets within VideoToolbox's own spread (two runs of FFmpeg's route differ by up to 0.7 % of
 * a frame's bytes, run-pass.test.ts), and the shot model's 48×27 stream (IX2-C3) within the RGB sets' bounds; each
 * detector at its own minimum (IX3-D2) reads the same black and freeze runs. It decodes with VideoToolbox: run it under the machine's VideoToolbox
 * lock. Skips without FFmpeg, the helper (native/mac-helper/build.sh) or a Mac.
 */
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countedContext,
  createDecodeTally,
  createJsonLineSidecar,
  createMacHelperDecodeService,
  createSidecarResolver,
  planNormalisation,
  probeMedia,
  readFrameSlots,
  runAnalysisPass,
  runProcess,
  type DecodeService,
  type MediaContext,
  type NormalisationPlan,
  type ProcessRunner,
} from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { findTestBinaries } from '../helpers/binaries';
import { renderClip } from '../helpers/clip';
import { differingShare, maxByteDifference } from '../helpers/frame-diff';

const found = await findTestBinaries('helper parity');
const helper = await createSidecarResolver({
  name: 'taalcut-mac-helper',
  development: true,
  pin: '',
  env: process.env,
}).resolve();
if (!helper.ok) console.warn(`helper parity: skipped, no mac helper (${helper.error.code})`);

/** Share of bytes two VideoToolbox reads of the same frames may differ in (run-pass.test.ts). */
const VT_SPREAD = 0.02;
/** The helper's RGB is BT.601/709 with 2×2 chroma; swscale's interpolates chroma: a few levels apart. */
const RGB_MEAN_LEVELS = 3;
/** Gray frame sets are swscale's bytes exactly (measured 2026-10-19: 0 bytes differ); this only bounds a VT spread. */
const GRAY_MAX_LEVELS = 24;
/** At saturated colour edges the 2×2 chroma differs a lot from swscale's vertically interpolated chroma: few bytes. */
const RGB_FAR_SHARE = 0.05;
const FAR_LEVELS = 16;
const FRAMES = 195;
/** One 48×27 RGB24 frame of the shot model's stream. */
const STREAM = 48 * 27 * 3;

const farShare = (a: Buffer | undefined, b: Buffer | undefined) =>
  !a || !b || a.length !== b.length
    ? 1
    : a.reduce((count, v, i) => count + (Math.abs(v - (b[i] ?? 0)) > FAR_LEVELS ? 1 : 0), 0) / a.length;

const meanDifference = (a: Buffer | undefined, b: Buffer | undefined) =>
  !a || !b || a.length !== b.length
    ? 255
    : a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0) / a.length;

describe.skipIf(!found.binaries || !helper.ok || process.platform !== 'darwin')(
  'the pass on the mac helper',
  () => {
    let dir: string;
    let ctx: MediaContext;
    let service: DecodeService;
    const clips = new Map<string, { path: string; plan: NormalisationPlan }>();
    let passes = 0;

    beforeAll(async () => {
      dir = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-parity-')));
      ctx = { binaries: found.binaries! };
      const sidecar = createJsonLineSidecar({
        command: helper.ok ? helper.value.path : '',
        args: ['serve', '--services', 'decode', '--allow-root', dir],
        holdsVideoSession: true,
      });
      const real = createMacHelperDecodeService(sidecar);
      service = { ...real, pass: (request, options) => ((passes += 1), real.pass(request, options)) };
      const encode = [...softwareH264FixtureFlags(), '-g', '30', '-pix_fmt', 'yuv420p'];
      const sources: Record<string, { args: string[]; turn?: number }> = {
        // A cut at 45, black 45–120 (blackdetect's 2 s), then 2.5 s of still bars (a freeze).
        reel: {
          args: [
            ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=1.5'],
            ...['-f', 'lavfi', '-i', 'color=c=black:size=1280x720:rate=30:duration=2.5'],
            ...['-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=30:duration=2.5'],
            ...['-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[v]', '-map', '[v]', ...encode],
          ],
        },
        // IX3-D2: 0.4 s of black (a fade's), then 2.2 s of black and 2.5 s of still bars (freezes of 2 s or more).
        blinks: {
          args: [
            ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=1'],
            ...['-f', 'lavfi', '-i', 'color=c=black:size=1280x720:rate=30:duration=0.4'],
            ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=1.5'],
            ...['-f', 'lavfi', '-i', 'color=c=black:size=1280x720:rate=30:duration=2.2'],
            ...['-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=30:duration=2.5'],
            ...['-filter_complex', '[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1[v]', '-map', '[v]', ...encode],
          ],
        },
        // Full range, NTSC rate, and turned a quarter (a phone held upright).
        turned: {
          args: [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=1280x720:rate=30000/1001:duration=2',
            ...encode,
            '-color_range',
            'pc',
          ],
          turn: 90,
        },
      };
      for (const [name, source] of Object.entries(sources)) {
        const path = join(dir, `${name}.mp4`);
        const flat = join(dir, `${name}-flat.mp4`);
        const made = source.turn
          ? (await renderClip(ctx, flat, source.args)) &&
            (await renderClip(ctx, path, [
              '-display_rotation',
              String(source.turn),
              '-i',
              flat,
              '-c',
              'copy',
            ]))
          : await renderClip(ctx, path, source.args);
        if (!made) continue;
        const probed = await probeMedia(path, ctx);
        const plan = probed.ok ? planNormalisation(probed.value, {}) : undefined;
        if (plan?.ok && plan.value.decode.backend === 'videotoolbox')
          clips.set(name, { path, plan: plan.value });
      }
    }, 240_000);

    afterAll(async () => {
      await service?.close();
      await rm(dir, { recursive: true, force: true });
    });

    async function pass(
      name: string,
      withService: boolean,
      window?: { from: number; frames: number },
      runner?: ProcessRunner,
    ) {
      const clip = clips.get(name)!;
      const gray = new Map<number, Buffer>();
      const stream = new Map<number, Buffer>();
      const tally = createDecodeTally(clip.path);
      const before = passes;
      const counted = countedContext(runner ? { ...ctx, runner } : ctx, tally);
      const run = await runAnalysisPass(clip.path, clip.plan, counted, {
        size: 256,
        coarseEvery: 3,
        dir,
        onFrame: (frame) => gray.set(frame.index, frame.data),
        rgbStream: {
          width: 48,
          height: 27,
          every: 1,
          onFrames: async (batch) => {
            for (let i = 0; i < batch.count; i++)
              stream.set(batch.index + i, Buffer.from(batch.data.subarray(i * STREAM, (i + 1) * STREAM)));
          },
        },
        frameSets: [
          { set: 'ocr', size: { longSide: 640 }, format: 'rgb24', every: 30, maxFrames: 4 },
          {
            set: 'look',
            size: { width: 224, height: 224, exact: true },
            format: 'gray8',
            every: 15,
            maxFrames: 20,
          },
        ],
        ...(window ? { window, detectMinSeconds: 0 } : {}),
        ...(withService ? { decodeService: service } : {}),
      });
      if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
      return { result: run.value, gray, stream, decodes: tally.snapshot(), helped: passes > before };
    }

    async function compareSets(
      helped: Awaited<ReturnType<typeof pass>>['result'],
      ffmpeg: Awaited<ReturnType<typeof pass>>['result'],
    ) {
      expect(helped.files.map((f) => [f.set, f.width, f.height, f.slots.map((s) => s.index)])).toEqual(
        ffmpeg.files.map((f) => [f.set, f.width, f.height, f.slots.map((s) => s.index)]),
      );
      const worst = { rgbMean: 0, rgbMax: 0, rgbFar: 0, grayShare: 0, grayMax: 0 };
      for (const [i, file] of helped.files.entries()) {
        const other = ffmpeg.files[i]!;
        const ours = await readFrameSlots(file.path, file.slots);
        const theirs = await readFrameSlots(other.path, other.slots);
        if (!ours.ok || !theirs.ok) throw new Error('frame file unreadable');
        for (const slot of file.slots) {
          const a = ours.value.get(slot.index);
          const b = theirs.value.get(slot.index);
          if (file.format === 'rgb24') {
            worst.rgbMean = Math.max(worst.rgbMean, meanDifference(a, b));
            worst.rgbMax = Math.max(worst.rgbMax, maxByteDifference(a, b));
            worst.rgbFar = Math.max(worst.rgbFar, farShare(a, b));
          } else {
            worst.grayShare = Math.max(worst.grayShare, differingShare(a, b));
            worst.grayMax = Math.max(worst.grayMax, maxByteDifference(a, b));
          }
        }
      }
      console.warn(`helper parity sets: ${JSON.stringify(worst)}`);
      expect(worst.rgbMean).toBeLessThanOrEqual(RGB_MEAN_LEVELS);
      expect(worst.rgbFar).toBeLessThanOrEqual(RGB_FAR_SHARE);
      // Gray sets: the scaled luma, stretched to full range as swscale does; within VideoToolbox's own spread.
      expect(worst.grayShare).toBeLessThanOrEqual(VT_SPREAD);
      expect(worst.grayMax).toBeLessThanOrEqual(GRAY_MAX_LEVELS);
    }

    function compareAnalysis(
      helped: Awaited<ReturnType<typeof pass>>,
      ffmpeg: Awaited<ReturnType<typeof pass>>,
      frames: number,
    ) {
      expect(helped.result.frames).toBe(ffmpeg.result.frames);
      expect(helped.result.fine.map((s) => s.index)).toEqual(ffmpeg.result.fine.map((s) => s.index));
      expect(helped.result.coarse.map((s) => s.index)).toEqual(ffmpeg.result.coarse.map((s) => s.index));
      expect(helped.result.black.length).toBe(ffmpeg.result.black.length);
      helped.result.black.forEach((b, i) =>
        expect(b.startSec).toBeCloseTo(ffmpeg.result.black[i]!.startSec, 1),
      );
      expect(helped.result.freeze.length).toBe(ffmpeg.result.freeze.length);
      expect(helped.gray.size).toBe(frames);
      let worst = 0;
      let scoreGap = 0;
      for (const [index, data] of helped.gray)
        worst = Math.max(worst, differingShare(data, ffmpeg.gray.get(index)));
      helped.result.fine.forEach(
        (s, i) => (scoreGap = Math.max(scoreGap, Math.abs(s.score - ffmpeg.result.fine[i]!.score))),
      );
      expect([...helped.stream.keys()]).toEqual([...ffmpeg.stream.keys()]);
      expect(helped.stream.size).toBe(frames);
      let streamMean = 0;
      let streamFar = 0;
      for (const [index, data] of helped.stream) {
        streamMean = Math.max(streamMean, meanDifference(data, ffmpeg.stream.get(index)));
        streamFar = Math.max(streamFar, farShare(data, ffmpeg.stream.get(index)));
      }
      console.warn(
        `helper parity analysis: gray share ${worst.toFixed(4)}, score gap ${scoreGap.toFixed(3)}, ` +
          `stream mean ${streamMean.toFixed(3)} far ${streamFar.toFixed(4)}`,
      );
      expect(worst).toBeLessThanOrEqual(VT_SPREAD);
      expect(streamMean).toBeLessThanOrEqual(RGB_MEAN_LEVELS);
      expect(streamFar).toBeLessThanOrEqual(RGB_FAR_SHARE);
      const cut = (scores: readonly { score: number }[]) =>
        scores.reduce((best, s, i) => (s.score > (scores[best]?.score ?? 0) ? i : best), 0);
      expect(cut(helped.result.fine)).toBe(cut(ffmpeg.result.fine));
    }

    it('gives FFmpeg route frames, intervals, cut and frame sets within its spread', async (t) => {
      if (!clips.has('reel')) return t.skip('no clip');
      const ffmpeg = await pass('reel', false);
      const helped = await pass('reel', true);
      expect(helped.helped).toBe(true);
      expect(ffmpeg.result.frames).toBe(FRAMES);
      expect(ffmpeg.result.black).toHaveLength(1);
      compareAnalysis(helped, ffmpeg, FRAMES);
      await compareSets(helped.result, ffmpeg.result);
      // One decode either way; the helper's reader FFmpeg decodes nothing.
      expect(helped.decodes).toMatchObject({ ffmpeg: 1, fullDecodes: 1, originalFullDecodes: 1 });
      expect(ffmpeg.decodes).toMatchObject({ ffmpeg: 1, fullDecodes: 1, originalFullDecodes: 1 });
      expect((await readdir(dir)).filter((name) => /\.(txt|nv12|rgb)$/.test(name))).toEqual([]);
    });

    it('waits for a reader that starts after the helper would have given up on it (IX3-F4)', async (t) => {
      if (!clips.has('reel')) return t.skip('no clip');
      // The reader (the FFmpeg on the FIFO's raw NV12) starts 11 s late: past the helper's 10 s wait for a reader
      // (RawSink.readerWaitSeconds), as a loaded Mac once started it. The pass stays on the helper.
      const late: ProcessRunner = async (command, args, options) => {
        if (args.includes('nv12')) await new Promise((resolve) => setTimeout(resolve, 11_000));
        return runProcess(command, args, options);
      };
      const helped = await pass('reel', true, undefined, late);
      expect(helped.helped).toBe(true);
      expect(helped.result.frames).toBe(FRAMES);
      expect(helped.decodes).toMatchObject({ ffmpeg: 1, fullDecodes: 1, originalFullDecodes: 1 });
    }, 90_000);

    it('decodes a window as FFmpeg does, from the keyframe before it', async (t) => {
      if (!clips.has('reel')) return t.skip('no clip');
      const window = { from: 45, frames: 90 };
      const ffmpeg = await pass('reel', false, window);
      const helped = await pass('reel', true, window);
      expect(helped.helped).toBe(true);
      expect(helped.result.fine[0]?.index).toBe(45);
      compareAnalysis(helped, ffmpeg, 90);
      await compareSets(helped.result, ffmpeg.result);
      expect(helped.decodes).toMatchObject({ partialDecodes: 1, fullDecodes: 0 });
    });

    it('reports every black run and freezes of 2 s when asked per detector, as FFmpeg’s route does (IX3-D2)', async (t) => {
      const clip = clips.get('blinks');
      if (!clip) return t.skip('no clip');
      const run = async (withService: boolean, detectMinSeconds?: { black: number }) => {
        const before = passes;
        const result = await runAnalysisPass(clip.path, clip.plan, ctx, {
          size: 256,
          coarseEvery: 3,
          dir,
          ...(detectMinSeconds ? { detectMinSeconds } : {}),
          ...(withService ? { decodeService: service } : {}),
        });
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
        return { ...result.value, helped: passes > before };
      };
      const helped = await run(true, { black: 0 });
      const helpedByDefault = await run(true);
      const ffmpeg = await run(false, { black: 0 });
      expect([helped.helped, helpedByDefault.helped, ffmpeg.helped]).toEqual([true, true, false]);
      // Both blacks, the 0.4 s one included, where FFmpeg's route reads them.
      expect(helped.black).toHaveLength(2);
      expect(ffmpeg.black).toHaveLength(2);
      helped.black.forEach((b, i) => {
        expect(b.startSec).toBeCloseTo(ffmpeg.black[i]!.startSec, 1);
        expect(b.endSec).toBeCloseTo(ffmpeg.black[i]!.endSec, 1);
      });
      expect(helpedByDefault.black).toHaveLength(1);
      // Freezes as today's pass gives them: 2 s or more (the short black is no freeze), the same on both routes.
      expect(helped.freeze).toEqual(helpedByDefault.freeze);
      expect(helped.freeze.length).toBeGreaterThan(0);
      expect(helped.freeze.every((f) => f.endSec - f.startSec >= 2)).toBe(true);
      expect(helped.freeze.length).toBe(ffmpeg.freeze.length);
    });

    it('turns a rotated full-range clip upright and keeps its range', async (t) => {
      const clip = clips.get('turned');
      if (!clip) return t.skip('no clip');
      expect(clip.plan.rotation === 90 || clip.plan.rotation === 270).toBe(true);
      const ffmpeg = await pass('turned', false);
      const helped = await pass('turned', true);
      expect(helped.helped).toBe(true);
      expect(helped.result.files[0]).toMatchObject({ width: 360, height: 640 });
      compareAnalysis(helped, ffmpeg, ffmpeg.result.frames);
      await compareSets(helped.result, ffmpeg.result);
    });
  },
);
