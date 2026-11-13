// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-F6 with the real FFmpeg: every job that decodes on the hardware route runs again on the software route
 * when the hardware decoder won't start, and says so.
 * - On a Mac the runner plays a VideoToolbox that refuses every session: a run with `-hwaccel` fails with FFmpeg's
 *   own line (and the graph error that follows it), and the VideoToolbox encoders refuse to open; every other run
 *   is the real FFmpeg, decoding in software. Nothing here reaches VideoToolbox. A real refusal can't be triggered
 *   on demand (on a Mac it only came under load), so the refusal is played.
 * - On Linux the refusal is real: every run has `CUDA_VISIBLE_DEVICES=-1`, so NVDEC finds no device ("No device
 *   available for decoder: device type cuda needed") and NVENC fails `cuInit`. The plan still names CUDA (no
 *   machine answer in the context), as one made before the GPU went away would.
 */
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import {
  analyseVideo,
  conform,
  contactSheet,
  decodeFrameSets,
  decodeKeyframes,
  makeFilmstrip,
  makeThumbnail,
  runAnalysisPass,
  hardwareBackends,
  runProcess,
  sampleFrames,
  type MediaContext,
  type NormalisationPlan,
  type ProcessRunner,
} from '@taalcut/media';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findTestBinaries } from '../helpers/binaries';
import { planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('hardware decode that will not start');
const binaries = found.binaries;
const SETUP_LINE =
  '[h264 @ 0x1] Failed setup for format videotoolbox_vld: hwaccel initialisation returned error.\n' +
  "Impossible to convert between the formats supported by the filter 'Parsed_split_3' and the filter 'auto_scale_0'\n";

const MAC = process.platform === 'darwin';
const ROW = hardwareBackends(process.platform)[0];
/** What the fallback's detail names: VideoToolbox's frame format, or the CUDA device that isn't there. */
const REFUSAL = MAC ? 'videotoolbox_vld' : 'no cuda device';

/** The real runner, except that the hardware refuses every decode session and every encoder. */
function refusingHardware(calls: string[][]): ProcessRunner {
  return async (command, args, options) => {
    calls.push([...args]);
    if (!MAC)
      return runProcess(command, args, { ...options, env: { ...options?.env, CUDA_VISIBLE_DEVICES: '-1' } });
    const refused = (stderrTail: string) =>
      ok({ exitCode: 1, signal: null, stdout: Buffer.alloc(0), stderrTail, durationMs: 1 });
    if (args.includes('-hwaccel')) return refused(SETUP_LINE);
    if (!args.includes('-require_sw') && args.some((arg) => arg.endsWith('_videotoolbox')))
      return refused('Error while opening encoder');
    return runProcess(command, args, options);
  };
}

describe.skipIf(!binaries || !ROW || !['darwin', 'linux'].includes(process.platform))(
  'a hardware decoder that will not start',
  () => {
    let dir: string;
    let clip: string;
    let plan: NormalisationPlan;
    let calls: string[][];
    let events: ComputeFallbackEvent[];
    let ctx: MediaContext;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'taalcut-hw-refused-'));
      clip = join(dir, 'clip.mp4');
      if (!binaries) throw new Error('no FFmpeg');
      // Four seconds, a keyframe each second, software-encoded.
      const made = await renderClip({ binaries }, clip, [
        ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4'],
        ...[...softwareH264FixtureFlags(), '-pix_fmt', 'yuv420p', '-g', '30'],
      ]);
      if (!made) throw new Error('fixture clip');
      const planned = await planClip(clip, { binaries });
      if (!planned.ok) throw new Error(planned.error.code);
      plan = planned.value;
    }, 120_000);

    beforeEach(() => {
      if (!binaries) throw new Error('no FFmpeg');
      calls = [];
      events = [];
      ctx = {
        binaries,
        runner: refusingHardware(calls),
        onComputeFallback: (event) => events.push(event),
      };
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    /** The job tried the hardware first, then decoded the clip in software, and the fallback was reported. */
    const fellBack = () => {
      // Runs that read the clip (not an encoder probe on a test pattern).
      const decodes = calls.filter((args) => args[args.indexOf('-i') + 1] === `file:${clip}`);
      expect(decodes[0]).toContain('-hwaccel');
      expect(decodes.at(-1)).not.toContain('-hwaccel');
      expect(
        events.some(
          (event) =>
            event.operation === 'media.decode' &&
            event.reason === 'accelerator_failed' &&
            (event.detail ?? '').includes(REFUSAL),
        ),
      ).toBe(true);
    };

    it('starts on the hardware route on this machine', () => {
      expect(plan.decode.backend).toBe(ROW);
    });

    it('the analysis pass', async () => {
      let frames = 0;
      const result = await runAnalysisPass(clip, plan, ctx, { dir, onFrame: () => void frames++ });
      expect(result.ok && result.value.frames).toBe(120);
      expect(frames).toBe(120);
      fellBack();
    });

    it('frame sets (OCR, shots and embed reads, exact posters)', async () => {
      const sets = [{ set: 'ocr', size: { longSide: 128 }, format: 'gray8' as const, frames: [0, 45, 90] }];
      const result = await decodeFrameSets(clip, plan, ctx, { sets, dir });
      expect(result.ok && result.value.map((file) => file.slots.length)).toEqual([3]);
      fellBack();
    });

    it('keyframes (posters)', async () => {
      const result = await decodeKeyframes(clip, plan, ctx, {
        targets: [0.4, 1.2, 2.0],
        size: { longSide: 128 },
        dir,
      });
      expect(result.ok && result.value?.count).toBeGreaterThan(0);
      fellBack();
    });

    it('the thumbnail and the filmstrip', async () => {
      const thumb = await makeThumbnail(clip, plan, ctx, join(dir, 'thumb.jpg'));
      expect(thumb.ok).toBe(true);
      fellBack();
      calls.length = 0;
      events.length = 0;
      const strip = await makeFilmstrip(clip, plan, ctx, { out: join(dir, 'strip.jpg') });
      expect(strip.ok).toBe(true);
      fellBack();
    });

    it('sampled frames (embed) and the scene analysis', async () => {
      let frames = 0;
      const sampled = await sampleFrames(clip, plan, ctx, {
        size: 64,
        format: 'gray8',
        every: 30,
        onFrame: () => void frames++,
      });
      expect(sampled.ok && sampled.value.frames).toBe(4);
      expect(frames).toBe(4);
      fellBack();
      calls.length = 0;
      events.length = 0;
      const analysed = await analyseVideo(clip, plan, ctx, { every: 1 });
      expect(analysed.ok && analysed.value.scenes.length).toBeGreaterThan(0);
      fellBack();
    });

    it('a contact sheet and a conform', async () => {
      const sheet = await contactSheet(clip, plan, ctx, {
        frames: [0, 60],
        columns: 2,
        tileLongSide: 64,
        out: join(dir, 'sheet.jpg'),
      });
      expect(sheet.ok).toBe(true);
      fellBack();
      calls.length = 0;
      events.length = 0;
      const conformed = await conform(clip, plan, ctx, { out: join(dir, 'conformed.mp4'), codec: 'h264' });
      expect(conformed.ok).toBe(true);
      fellBack();
      // The hardware encoder didn't open either: the conform encoded on the CPU, and said so.
      const encodes = calls.filter(
        (args) => args[args.indexOf('-i') + 1] === `file:${clip}` && args.includes('-c:v'),
      );
      expect(encodes.at(-1)?.join(' ')).toContain(softwareH264FixtureFlags().join(' '));
      expect(
        events.some((event) => event.operation === 'media.encode' && event.reason === 'accelerator_failed'),
      ).toBe(true);
    }, 60_000);
  },
);
