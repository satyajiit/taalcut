// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D1: frame sets decoded through one multi-branch graph are byte for byte
 * the frames `sampleFrames` (one chain per size) reads, on an SDR clip, a
 * portrait phone clip (display matrix), a mirrored one and a 10-bit HLG clip
 * (tone-mapped); several sizes come out of one run per seek window; files
 * index their frames and read back single slots. HDR is "the same within the
 * old path's own spread": libplacebo reads its peak detection back
 * asynchronously, so two single-chain reads of the same HLG frames differed by
 * up to 4 levels (measured 2026-10-17, 6 repeats); SDR frames are exact.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDecodeTally,
  countedContext,
  decodeFrameSets,
  readFrameSlots,
  sampleFrames,
  type MediaContext,
  type NormalisationPlan,
  ToneMapSelection,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { maxByteDifference } from '../helpers/frame-diff';
import { planClip, renderClip } from '../helpers/clip';
import { makeFixtures, type Fixtures } from '../helpers/fixtures';

const found = await findTestBinaries('frame sets');

/** Levels two reads of the same tone-mapped frame may differ by (libplacebo's asynchronous peak detection). */
const HDR_SPREAD = 6;

type Format = 'rgb24' | 'gray8' | 'jpeg';
type Size = { width: number; height: number; exact: true } | { longSide: number };

describe.skipIf(!found.binaries)('frame sets match single-chain sampling', () => {
  let ctx: MediaContext;
  let fixtures: Fixtures;
  let out: string;
  const clips = new Map<string, { path: string; plan: NormalisationPlan }>();

  beforeAll(async () => {
    // The tone-map choice is proven once per process (as the jobs process does), so counts are per read.
    // A selection that failed (its filter listing timed out on a loaded machine) is not kept, and the next read would
    // run it again inside the count: retry until one is kept.
    const toneMaps = new ToneMapSelection();
    ctx = { binaries: found.binaries!, toneMaps };
    let warmed = await toneMaps.get(ctx);
    for (let retry = 0; !warmed.ok && retry < 2; retry++) warmed = await toneMaps.get(ctx);
    if (!warmed.ok) throw new Error(`tone-map selection: ${warmed.error.code} ${warmed.error.detail ?? ''}`);
    fixtures = await makeFixtures(ctx, ['h264', 'rotated', 'hevcHlg']);
    out = await mkdtemp(join(tmpdir(), 'taalcut-frame-sets-'));
    const mirrored = join(fixtures.dir, 'mirrored.mov');
    if (fixtures.paths.h264)
      await renderClip(ctx, mirrored, [
        ...['-display_rotation', '90', '-display_hflip', '-i', fixtures.paths.h264],
        ...['-map', '0:v', '-c', 'copy'],
      ]);
    const named = { sdr: fixtures.paths.h264, rotated: fixtures.paths.rotated, hlg: fixtures.paths.hevcHlg };
    for (const [name, path] of [...Object.entries(named), ['mirrored', mirrored] as const]) {
      if (!path) continue;
      const plan = await planClip(path, ctx);
      if (plan.ok) clips.set(name, { path, plan: plan.value });
    }
  }, 240_000);
  afterAll(async () => {
    await rm(out, { recursive: true, force: true });
    if (fixtures) await rm(fixtures.dir, { recursive: true, force: true });
  });

  const single = async (
    clip: { path: string; plan: NormalisationPlan },
    size: Size,
    format: Format,
    frames: number[],
  ) => {
    const got = new Map<number, Buffer>();
    const run = await sampleFrames(clip.path, clip.plan, ctx, {
      size: 'longSide' in size ? size.longSide : { width: size.width, height: size.height },
      format,
      frames,
      onFrame: (frame) => got.set(frame.index, frame.data),
    });
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
    return got;
  };

  // libplacebo on the HLG clip opens a Vulkan device per run (about 1.6 s on Linux's NVIDIA driver).
  it.for(['sdr', 'rotated', 'mirrored', 'hlg'])(
    '%s: several sizes in one run, the same bytes',
    { timeout: 120_000 },
    async (name, t) => {
      const clip = clips.get(name);
      if (!clip) return t.skip(`no ${name} clip`);
      const frames = [0, 3, 7, 20];
      const sets = [
        {
          set: 'model',
          size: { width: 96, height: 64, exact: true as const },
          format: 'rgb24' as const,
          frames,
        },
        { set: 'stats', size: { longSide: 128 }, format: 'gray8' as const, frames: [3, 20] },
        { set: 'jpeg', size: { longSide: 160 }, format: 'jpeg' as const, frames: [7] },
      ];
      const tally = createDecodeTally(clip.path);
      const files = await decodeFrameSets(clip.path, clip.plan, countedContext(ctx, tally), {
        sets,
        dir: out,
      });
      if (!files.ok) throw new Error(`${files.error.code}: ${files.error.detail ?? ''}`);
      // Frames under 2 s apart share one seek: one FFmpeg run for all three sets.
      expect(tally.snapshot()).toMatchObject({ ffmpeg: 1, partialDecodes: 1, fullDecodes: 0 });
      for (const set of sets) {
        const file = files.value.find((f) => f.set === set.set)!;
        expect(file.slots.map((s) => s.index)).toEqual(set.frames);
        const read = await readFrameSlots(file.path, file.slots);
        if (!read.ok) throw new Error(read.error.code);
        const size: Size = 'exact' in set.size ? set.size : { longSide: set.size.longSide };
        const expected = await single(clip, size, set.format, set.frames);
        for (const index of set.frames) {
          const got = read.value.get(index);
          // A JPEG of a frame a few levels off is other bytes: for HDR, check it is a JPEG.
          if (set.format === 'jpeg' && name === 'hlg') {
            expect(got?.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), `${set.set} ${index}`).toBe(true);
            continue;
          }
          const limit = name === 'hlg' ? HDR_SPREAD : 0;
          expect(maxByteDifference(got, expected.get(index)), `${set.set} ${index}`).toBeLessThanOrEqual(
            limit,
          );
        }
      }
    },
  );

  it('splits far-apart frames into one seek each', async (t) => {
    const clip = clips.get('sdr');
    if (!clip) return t.skip('no sdr clip');
    const tally = createDecodeTally(clip.path);
    // 29.97 fps, 2 s long: frames 0 and 59 are just under 2 s apart (one window).
    const files = await decodeFrameSets(clip.path, clip.plan, countedContext(ctx, tally), {
      sets: [{ set: 'a', size: { longSide: 64 }, format: 'gray8', frames: [59, 0, 0] }],
      dir: out,
    });
    expect(files.ok && files.value.flatMap((f) => f.slots.map((s) => s.index))).toEqual([0, 59]);
    expect(tally.snapshot().ffmpeg).toBe(1);
  });

  it('leaves frames past the end out', async (t) => {
    const clip = clips.get('sdr');
    if (!clip) return t.skip('no sdr clip');
    const files = await decodeFrameSets(clip.path, clip.plan, ctx, {
      sets: [{ set: 'a', size: { longSide: 64 }, format: 'gray8', frames: [58, 59, 400] }],
      dir: out,
    });
    expect(files.ok && files.value.flatMap((f) => f.slots.map((s) => s.index))).toEqual([58, 59]);
  });
});
