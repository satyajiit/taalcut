// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-G3: frame sets read through the mac helper's `decode.frames` (one VideoToolbox session for every frame, NV12
 * converted by a CPU FFmpeg) are FFmpeg's VideoToolbox seeks' frames, byte for byte: rgb24 at an exact size (the
 * embedder's), gray8 at a long side, yuv420p at a long side that doesn't keep the aspect exactly (400 × 224 of
 * 640 × 360), on a video-range clip without colour tags, a
 * full-range NTSC-rate clip turned a quarter, and a BT.709-tagged one; frames in several seek windows, mid-GOP,
 * the last frame and one past the end. One helper read and one CPU FFmpeg (no hardware decode) for all of them.
 * Byte for byte, and each route repeats itself: FFmpeg 9.0.2 converts matrix-tagged NV12 on several threads, and at
 * some sizes and thread counts that conversion isn't repeatable (on 18 cores, gray at 256 × 144: a different frame
 * almost every run, against the one that one thread and most other thread counts give). The service converts on one
 * thread (`nv12-convert.ts`), and since IX2-F15 so does FFmpeg's route where VideoToolbox scaled the frames
 * (normalise/one-thread.ts); each route is read twice to show it.
 * It decodes with VideoToolbox: run it under the machine's VideoToolbox lock. Skips without FFmpeg, the helper
 * (native/mac-helper/build.sh) or a Mac.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import {
  countedContext,
  createDecodeTally,
  createJsonLineSidecar,
  createMacHelperDecodeService,
  createSidecarResolver,
  decodeFrameSets,
  planNormalisation,
  probeMedia,
  readFrameSlots,
  type DecodeService,
  type FrameFile,
  type FrameSetRequest,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { findTestBinaries } from '../helpers/binaries';
import { renderClip } from '../helpers/clip';
import { differingShare } from '../helpers/frame-diff';

const found = await findTestBinaries('frame sets on the helper');
const helper = await createSidecarResolver({
  name: 'taalcut-mac-helper',
  development: true,
  pin: '',
  env: process.env,
}).resolve();
if (!helper.ok) console.warn(`frame sets on the helper: skipped, no mac helper (${helper.error.code})`);

/** 300 frames at 30 fps, a keyframe every 12: frames in four seek windows (2 s apart), mid-GOP, the last, one past the end. */
const FRAMES = [0, 5, 13, 100, 107, 230, 299, 310];
const LENGTH = 300;
const SETS: readonly Omit<FrameSetRequest, 'frames'>[] = [
  { set: 'embed', size: { width: 768, height: 384, exact: true }, format: 'rgb24' },
  { set: 'gray', size: { longSide: 256 }, format: 'gray8' },
  { set: 'planes', size: { longSide: 400 }, format: 'yuv420p' },
];

describe.skipIf(!found.binaries || !helper.ok || process.platform !== 'darwin')(
  'frame sets on the mac helper',
  () => {
    let dir: string;
    let ctx: MediaContext;
    let service: DecodeService;
    let reads = 0;
    const clips = new Map<string, { path: string; plan: NormalisationPlan }>();

    beforeAll(async () => {
      dir = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-frames-parity-')));
      ctx = { binaries: found.binaries! };
      const real = createMacHelperDecodeService(
        createJsonLineSidecar({
          command: helper.ok ? helper.value.path : '',
          args: ['serve', '--services', 'decode', '--allow-root', dir],
          holdsVideoSession: true,
        }),
      );
      service = { ...real, frames: (request, options) => ((reads += 1), real.frames(request, options)) };
      const encode = [...softwareH264FixtureFlags(), '-g', '12', '-pix_fmt', 'yuv420p'];
      const source = (rate: string) => [
        ...['-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${rate}`],
        ...['-frames:v', String(LENGTH)],
      ];
      const sources: Record<string, string[]> = {
        plain: [...source('30'), ...encode],
        tagged: [
          ...source('30'),
          ...encode,
          ...['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'],
        ],
      };
      for (const [name, args] of Object.entries(sources)) {
        const path = join(dir, `${name}.mp4`);
        if (await renderClip(ctx, path, args)) await keep(name, path);
      }
      // Full range, NTSC rate, turned a quarter (a phone held upright).
      const flat = join(dir, 'turned-flat.mp4');
      const turned = join(dir, 'turned.mp4');
      if (
        (await renderClip(ctx, flat, [...source('30000/1001'), ...encode, '-color_range', 'pc'])) &&
        (await renderClip(ctx, turned, ['-display_rotation', '90', '-i', flat, '-c', 'copy']))
      )
        await keep('turned', turned);
    }, 240_000);

    async function keep(name: string, path: string) {
      const probed = await probeMedia(path, ctx);
      const plan = probed.ok ? planNormalisation(probed.value, {}) : undefined;
      if (plan?.ok && plan.value.decode.backend === 'videotoolbox')
        clips.set(name, { path, plan: plan.value });
    }

    afterAll(async () => {
      await service?.close();
      await rm(dir, { recursive: true, force: true });
    });

    async function read(name: string, withService: boolean) {
      const clip = clips.get(name)!;
      const tally = createDecodeTally(clip.path);
      const before = reads;
      const out = await mkdtemp(join(dir, `${name}-`));
      const files = await decodeFrameSets(clip.path, clip.plan, countedContext(ctx, tally), {
        sets: SETS.map((set) => ({ ...set, frames: FRAMES })),
        dir: out,
        ...(withService ? { decodeService: service } : {}),
      });
      if (!files.ok) throw new Error(`${files.error.code}: ${files.error.detail ?? ''}`);
      return { files: files.value, decodes: tally.snapshot(), helped: reads - before };
    }

    /** Each set's frames by grid frame, whichever files hold them. */
    async function framesBySet(files: readonly FrameFile[]) {
      const sets = new Map<string, Map<number, Buffer>>();
      for (const file of files) {
        const frames = sets.get(file.set) ?? new Map<number, Buffer>();
        for (const [index, data] of unwrap(await readFrameSlots(file.path, file.slots)))
          frames.set(index, data);
        sets.set(file.set, frames);
      }
      return sets;
    }

    /** Per set, the largest share of bytes that differ between two reads' frames of the same grid frame. */
    function worstBySet(a: Map<string, Map<number, Buffer>>, b: Map<string, Map<number, Buffer>>) {
      const worst: Record<string, number> = {};
      for (const [set, frames] of a)
        for (const [index, data] of frames)
          worst[set] = Math.max(worst[set] ?? 0, differingShare(data, b.get(set)?.get(index)));
      return worst;
    }

    for (const name of ['plain', 'tagged', 'turned']) {
      it(`gives FFmpeg's frames byte for byte (${name})`, async (t) => {
        if (!clips.has(name)) return t.skip('no clip');
        const ffmpeg = await read(name, false);
        const ffmpegAgain = await read(name, false);
        const helped = await read(name, true);
        const helpedAgain = await read(name, true);
        expect([helped.helped, helpedAgain.helped]).toEqual([1, 1]);
        // FFmpeg writes a file per seek window and set, the helper one per set: each set's frames by grid frame.
        const formats = (files: readonly FrameFile[]) => [
          ...new Set(files.map((f) => `${f.set} ${f.format} ${f.width}x${f.height}`)),
        ];
        expect(formats(helped.files)).toEqual(formats(ffmpeg.files));
        const ours = await framesBySet(helped.files);
        const theirs = await framesBySet(ffmpeg.files);
        expect([...ours.keys()]).toEqual([...theirs.keys()]);
        for (const [set, frames] of theirs) {
          // Every frame but the one past the end, in every set, on both routes.
          expect([...frames.keys()]).toEqual(FRAMES.slice(0, -1));
          expect([...(ours.get(set)?.keys() ?? [])]).toEqual(FRAMES.slice(0, -1));
        }
        const against = worstBySet(theirs, ours);
        const ffmpegRepeat = worstBySet(theirs, await framesBySet(ffmpegAgain.files));
        const oursRepeat = worstBySet(ours, await framesBySet(helpedAgain.files));
        console.warn(
          `frame sets on the helper (${name}): worst differing share per set against FFmpeg ` +
            `${JSON.stringify(against)}; FFmpeg against itself ${JSON.stringify(ffmpegRepeat)}; ` +
            `the helper against itself ${JSON.stringify(oursRepeat)}`,
        );
        expect(oursRepeat).toEqual({ embed: 0, gray: 0, planes: 0 });
        // Every set repeats on FFmpeg's route too (IX2-F15), so every set compares exactly.
        expect(ffmpegRepeat).toEqual({ embed: 0, gray: 0, planes: 0 });
        expect(against).toEqual({ embed: 0, gray: 0, planes: 0 });
        // FFmpeg: one VideoToolbox run per seek window. The helper: one read, one CPU conversion, no hardware decode.
        expect(ffmpeg.decodes.ffmpeg).toBe(4);
        expect(helped.decodes).toMatchObject({ ffmpeg: 1, partialDecodes: 1, fullDecodes: 0 });
      });
    }
  },
);
