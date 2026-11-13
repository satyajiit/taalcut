// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T2 on real files: the poster's candidates are the first keyframes at or
 * after 10–90 % of the clip, each decoded alone, in one run when they are
 * close; the hardware decoder (VideoToolbox, NVDEC) and the software decoder read the same ones; a keyframe
 * read is the same picture an exact read of that frame gives, upright,
 * un-mirrored and tone-mapped (a portrait mirrored H.264 clip, 10-bit HLG
 * HEVC and its rotated copy); a black first second never becomes the poster;
 * and a clip with too few keyframes falls back to the exact frames.
 * Fixtures: flat-grey clips whose level is their frame number (libopenh264),
 * testsrc2 for the turned clip, and HLG from the platform's hardware HEVC encoder (hevc_videotoolbox, hevc_nvenc:
 * the LGPL build has no software HEVC encoder; hdr.test.ts makes its HLG the same way).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RationalTime } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countedContext,
  createDecodeTally,
  decodeFrameSets,
  decodeKeyframes,
  hardwareBackends,
  hardwareEncoderFor,
  makeThumbnail,
  POSTER_FRACTIONS,
  readFrameSlots,
  runProcess,
  ToneMapSelection,
  type DecodeKeyframesOptions,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder } from '../helpers/clip';
import { maxByteDifference } from '../helpers/frame-diff';
import {
  firstKeyframesAtOrAfter,
  greyClipArgs,
  keyframeTimes,
  meanLuma,
  plannedClip,
  rampLevel,
  type PlannedClip,
} from '../helpers/keyframe-clips';

const found = await findTestBinaries('keyframe thumbnails');
const ROW = hardwareBackends(process.platform)[0];
const HEVC = ROW && hardwareEncoderFor(ROW, 'hevc');
const bundled = HEVC && found.binaries?.verified ? found.binaries : undefined;

/** Levels two reads of the same tone-mapped frame may differ by (libplacebo's peak detection; frame-sets.test.ts). */
const HDR_SPREAD = 6;
const RAMP = { fps: 10, seconds: 11, gop: 10, black: 10 };

type Clip = PlannedClip;
type ClipName = 'ramp' | 'oneKey' | 'turned' | 'hlg' | 'hlgPortrait';

describe.skipIf(!bundled)('keyframe poster frames', { timeout: 120_000 }, () => {
  let ctx: MediaContext;
  let dir: string;
  let clips: Record<ClipName, Clip>;

  beforeAll(async () => {
    if (!bundled) throw new Error('no bundled FFmpeg');
    ctx = { binaries: bundled, toneMaps: new ToneMapSelection() };
    dir = await mkdtemp(join(tmpdir(), 'taalcut-keyframes-'));
    const h264 = await h264Encoder(ctx);
    if (!h264) throw new Error('no H.264 encoder');
    const grey = (seconds: number, gop: number, black: number) =>
      greyClipArgs({
        size: '320x240',
        fps: RAMP.fps,
        seconds,
        gop,
        level: `if(lt(N\\,${black})\\,16\\,16+2*N)`,
        encoder: h264,
      });
    const hlgArgs = [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-t', '6'],
      '-vf',
      'zscale=pin=bt709:tin=bt709:min=bt709:rin=full:p=bt2020:t=arib-std-b67:m=bt2020nc:r=tv:npl=203,format=p010le',
      ...['-c:v', HEVC!, '-profile:v', 'main10', '-g', '10', '-tag:v', 'hvc1'],
      ...['-bsf:v', 'hevc_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9'],
      ...['-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc'],
    ];
    const at = (file: string) => join(dir, file);
    const upright = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-t', '6', ...h264, '-g', '10'];
    const hlg = await plannedClip(ctx, at('hlg.mov'), hlgArgs);
    // Turned and mirrored by the display matrix only, as phones write them.
    const copy = (flags: string[], from: Clip) => [...flags, '-i', from.path, '-map', '0:v', '-c', 'copy'];
    clips = {
      ramp: await plannedClip(ctx, at('ramp.mp4'), grey(RAMP.seconds, RAMP.gop, RAMP.black)),
      oneKey: await plannedClip(ctx, at('one-key.mp4'), grey(4, 1000, 0)),
      turned: await plannedClip(
        ctx,
        at('turned.mov'),
        copy(
          ['-display_rotation', '90', '-display_hflip'],
          await plannedClip(ctx, at('upright.mp4'), upright),
        ),
      ),
      hlg,
      hlgPortrait: await plannedClip(ctx, at('hlg-portrait.mov'), copy(['-display_rotation', '-90'], hlg)),
    };
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const software = (source: NormalisationPlan): NormalisationPlan => ({
    ...source,
    decode: { backend: 'software', fallbackReason: { code: 'requested', detail: 'test' } },
  });

  /** The keyframes' frames, decoded, with the read's FFmpeg count. */
  async function keyframes(source: Clip, options: Partial<DecodeKeyframesOptions> & { targets: number[] }) {
    const tally = createDecodeTally(source.path);
    const read = await decodeKeyframes(source.path, source.plan, countedContext(ctx, tally), {
      size: { longSide: 400 },
      dir,
      ...options,
    });
    if (!read.ok) throw new Error(`${read.error.code}: ${read.error.detail ?? ''}`);
    if (!read.value) throw new Error('route cannot skip to keyframes');
    const frames: Buffer[] = [];
    for (const file of read.value.files) {
      const slots = await readFrameSlots(file.path, file.slots);
      if (!slots.ok) throw new Error(slots.error.code);
      frames.push(...file.slots.flatMap((slot) => slots.value.get(slot.index) ?? []));
      await rm(file.path, { force: true });
    }
    const first = read.value.files[0];
    return {
      frames,
      runs: read.value.runs,
      tally: tally.snapshot(),
      width: first?.width ?? 0,
      height: first?.height ?? 0,
    };
  }

  const posterTargets = (source: Clip) =>
    POSTER_FRACTIONS.map((f) => f * RationalTime.toSeconds(source.plan.duration));

  it('reads the first keyframe at or after each target, alone, in one run when they are close', async () => {
    const ramp = clips.ramp;
    const targets = posterTargets(ramp);
    const expected = firstKeyframesAtOrAfter(await keyframeTimes(ctx, ramp.path), targets).map((t) =>
      rampLevel(Math.round(t * RAMP.fps), RAMP.black),
    );
    expect(expected.length).toBeGreaterThanOrEqual(4);
    const one = await keyframes(ramp, { targets });
    expect(one.runs).toBe(1);
    expect(one.tally).toMatchObject({ ffmpeg: 1, partialDecodes: 1, fullDecodes: 0 });
    expect(one.frames.map((f) => Math.round(meanLuma(f, one.width, one.height)))).toEqual(expected);
    // One seek per target reads the same keyframes.
    const apart = await keyframes(ramp, { targets, gapSeconds: 0 });
    expect(apart.runs).toBe(5);
    expect(apart.frames.map((f) => Math.round(meanLuma(f, apart.width, apart.height)))).toEqual(expected);
  });

  it('the hardware decoder and the software decoder read the same keyframes', async () => {
    const ramp = clips.ramp;
    const targets = posterTargets(ramp);
    expect(ramp.plan.decode.backend).toBe(ROW);
    const vt = await keyframes(ramp, { targets });
    const cpu = await keyframes({ ...ramp, plan: software(ramp.plan) }, { targets });
    expect(cpu.frames).toHaveLength(vt.frames.length);
    vt.frames.forEach((frame, i) => expect(maxByteDifference(frame, cpu.frames[i])).toBeLessThanOrEqual(1));
  });

  it.for([
    { name: 'turned' as const, spread: 0 },
    { name: 'hlg' as const, spread: HDR_SPREAD },
    { name: 'hlgPortrait' as const, spread: HDR_SPREAD },
  ])('$name: a keyframe read is the exact read of that frame', async ({ name, spread }) => {
    const source = clips[name];
    const rate = source.plan.frameRate.output;
    const fps = rate.num / rate.den;
    const times = await keyframeTimes(ctx, source.path);
    const picked = firstKeyframesAtOrAfter(times, [1.5, 3.5]);
    expect(picked.length).toBe(2);
    const read = await keyframes(source, { targets: [1.5, 3.5] });
    const exact = await decodeFrameSets(source.path, source.plan, ctx, {
      sets: [
        {
          set: 'exact',
          size: { longSide: 400 },
          format: 'yuv420p',
          frames: picked.map((t) => Math.round(t * fps)),
        },
      ],
      dir,
    });
    if (!exact.ok) throw new Error(exact.error.code);
    const [file] = exact.value;
    if (!file) throw new Error('no exact frames');
    const slots = await readFrameSlots(file.path, file.slots);
    if (!slots.ok) throw new Error(slots.error.code);
    // Upright: the portrait clips come out tall.
    if (name !== 'hlg') expect(read.height).toBeGreaterThan(read.width);
    expect([read.width, read.height]).toEqual([file.width, file.height]);
    file.slots.forEach((slot, i) => {
      expect(
        maxByteDifference(read.frames[i], slots.value.get(slot.index)),
        `${name} ${slot.index}`,
      ).toBeLessThanOrEqual(spread);
    });
  });

  /** The poster's mean luma, decoded from the JPEG. */
  async function posterLuma(path: string): Promise<number> {
    const gray = await runProcess(ctx.binaries.ffmpeg, [
      '-v',
      'error',
      '-i',
      path,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ]);
    if (!gray.ok) throw new Error(gray.error.code);
    const pixels = gray.value.stdout;
    return pixels.reduce((sum, v) => sum + v, 0) / pixels.length;
  }

  it('makes the poster from keyframes, never the black first second', async () => {
    const ramp = clips.ramp;
    const out = join(dir, 'ramp.jpg');
    const tally = createDecodeTally(ramp.path);
    const made = await makeThumbnail(ramp.path, ramp.plan, countedContext(ctx, tally), out);
    if (!made.ok) throw new Error(`${made.error.code}: ${made.error.detail ?? ''}`);
    expect(made.value).toMatchObject({ width: 320, height: 240, source: 'keyframes' });
    // One keyframe read and the pick (which decodes no video).
    expect(tally.snapshot()).toMatchObject({ ffmpeg: 2, partialDecodes: 1, fullDecodes: 0 });
    expect(await posterLuma(out)).toBeGreaterThan(30);
  });

  it('falls back to the exact frames when the clip has too few keyframes', async () => {
    const oneKey = clips.oneKey;
    expect(await keyframeTimes(ctx, oneKey.path)).toEqual([0]);
    const out = join(dir, 'one-key.jpg');
    const made = await makeThumbnail(oneKey.path, oneKey.plan, ctx, out);
    if (!made.ok) throw new Error(`${made.error.code}: ${made.error.detail ?? ''}`);
    expect(made.value).toMatchObject({ width: 320, height: 240, source: 'exact' });
  });
});
