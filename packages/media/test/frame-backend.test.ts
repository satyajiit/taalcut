// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * extractFrame's route choice and its one software retry, with a fake runner:
 * VideoToolbox first, software only with a recorded and reported reason.
 */
import { realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { err, ok } from '@taalcut/core';
import {
  createMediaService,
  extractFrame,
  HardwareFailures,
  MediaCancelled,
  type BackendFallback,
  type BuildInfo,
  type MediaContext,
  type ProcessOutput,
  type ProcessRunner,
} from '@taalcut/media';
import { pngHeader, probeOf, videoStream } from './helpers/probe-fixture';

const VT_FAILED =
  '[mpeg4 @ 0x1] Failed setup for format videotoolbox_vld: hwaccel initialisation returned error.\n' +
  "Impossible to convert between the formats supported by the filter 'graph -1 input' and 'auto_scale_0'\n" +
  '  Pixel formats:\n    src: yuv420p yuyv422 rgb24 bgr24 …';

const output = (overrides: Partial<ProcessOutput> = {}): ProcessOutput => ({
  exitCode: 0,
  signal: null,
  stdout: pngHeader(320, 240),
  stderrTail: '',
  durationMs: 5,
  ...overrides,
});

/** Answers the hardware run and the software run differently, and records every call. */
function fakeRunner(hardware: () => ReturnType<ProcessRunner>, software = async () => ok(output())) {
  const calls: string[][] = [];
  const runner: ProcessRunner = async (_command, args) => {
    calls.push([...args]);
    return args.includes('-hwaccel') ? hardware() : software();
  };
  return { runner, calls };
}

let dir: string;
let clip: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-frame-backend-'));
  clip = join(dir, 'clip.mp4');
  await writeFile(clip, 'not decoded: the runner is fake');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const at = { value: 1, rate: 2 };
const BINARIES = { ffmpeg: '/fake/ffmpeg', ffprobe: '/fake/ffprobe', source: 'env' } as const;
const BUILD: BuildInfo = {
  path: '/fake/ffmpeg',
  version: '9.0.2',
  licence: 'LGPL-2.1-or-later',
  licenceLine: 'ffmpeg is free software.',
  configuration: [],
};
const filtersOf = (args: readonly string[]) => args[args.indexOf('-vf') + 1];

function context(runner: ProcessRunner, extra: Partial<MediaContext> = {}) {
  const fallbacks: BackendFallback[] = [];
  const ctx: MediaContext = {
    binaries: BINARIES,
    runner,
    platform: 'darwin',
    onBackendFallback: (f) => fallbacks.push(f),
    ...extra,
  };
  return { ctx, fallbacks };
}

describe('extractFrame on VideoToolbox', () => {
  it('decodes, rotates and scales on the GPU, downloading the exact surface format', async () => {
    const { runner, calls } = fakeRunner(async () => ok(output({ stdout: pngHeader(120, 160) })));
    const { ctx, fallbacks } = context(runner);
    const video = videoStream({
      codec: 'hevc',
      pixelFormat: 'yuv420p10le',
      rotation: 90,
      width: 320,
      height: 240,
      displayWidth: 240,
      displayHeight: 320,
    });
    const frame = await extractFrame(clip, at, ctx, {
      probe: probeOf(clip, video),
      maxDimension: 160,
      format: 'png',
    });

    expect(frame.ok && frame.value).toMatchObject({ backend: 'videotoolbox', width: 120, height: 160 });
    expect(frame.ok && frame.value.fallbackReason).toBeUndefined();
    expect(calls).toHaveLength(1);
    const args = calls[0] ?? [];
    expect(args.slice(args.indexOf('-noautorotate'), args.indexOf('-ss'))).toEqual([
      '-noautorotate',
      '-hwaccel',
      'videotoolbox',
      '-hwaccel_output_format',
      'videotoolbox_vld',
    ]);
    // A PNG of a frame VideoToolbox scaled only converts on the CPU: on one thread, so it repeats (IX2-F15).
    expect(filtersOf(args)?.split(',')).toEqual([
      'sws_flags=bicubic:threads=1;sidedata=mode=delete:type=DISPLAYMATRIX',
      'transpose_vt=dir=clock',
      'scale_vt=w=120:h=160',
      'hwdownload',
      'format=p010le',
      'format=rgb24',
    ]);
    expect(fallbacks).toEqual([]);
  });

  it('no frame (a time past the last frame) is media.decode_failed without a software retry', async () => {
    const { runner, calls } = fakeRunner(async () => ok(output({ stdout: Buffer.alloc(0) })));
    const frame = await extractFrame(clip, at, context(runner).ctx, { probe: probeOf(clip) });
    expect(!frame.ok && frame.error.code).toBe('media.decode_failed');
    expect(calls).toHaveLength(1);
  });

  it('a cancelled hardware run stays cancelled', async () => {
    const { runner, calls } = fakeRunner(async () => err(MediaCancelled()));
    const frame = await extractFrame(clip, at, context(runner).ctx, { probe: probeOf(clip) });
    expect(!frame.ok && frame.error.code).toBe('media.cancelled');
    expect(calls).toHaveLength(1);
  });
});

describe('extractFrame software fallback', () => {
  it('retries once in software when VideoToolbox fails, records and reports why, and remembers', async () => {
    const { runner, calls } = fakeRunner(async () =>
      ok(output({ exitCode: 178, stdout: Buffer.alloc(0), stderrTail: VT_FAILED })),
    );
    const hardwareFailures = new HardwareFailures();
    const { ctx, fallbacks } = context(runner, { hardwareFailures });
    const probe = probeOf(clip, videoStream({ codec: 'mpeg4', profile: 'Simple Profile' }));

    const frame = await extractFrame(clip, at, ctx, { probe });
    const reason = {
      code: 'hardware_failed',
      detail:
        '[mpeg4 @ 0x1] Failed setup for format videotoolbox_vld: hwaccel initialisation returned error. / ' +
        "Impossible to convert between the formats supported by the filter 'graph -1 input' and 'auto_scale_0'",
    };
    expect(frame.ok && frame.value).toMatchObject({ backend: 'software', fallbackReason: reason });
    expect(calls.map((args) => args.includes('-hwaccel'))).toEqual([true, false]);
    expect(calls[1]).not.toContain('-noautorotate');
    expect(fallbacks).toEqual([{ operation: 'decode', subject: 'clip.mp4', reason }]);

    // The next frame of the same format goes straight to software, still with a reason.
    const again = await extractFrame(clip, at, ctx, { probe });
    expect(calls).toHaveLength(3);
    expect(again.ok && again.value.fallbackReason?.detail).toMatch(
      /^failed earlier for this format: \[mpeg4/,
    );
    expect(fallbacks).toHaveLength(2);
  });

  it('when software fails too, the error names both, and the format is not blamed', async () => {
    const { runner } = fakeRunner(
      async () => ok(output({ exitCode: 1, stdout: Buffer.alloc(0), stderrTail: 'Invalid data found' })),
      async () => ok(output({ exitCode: 1, stdout: Buffer.alloc(0), stderrTail: 'Invalid data found' })),
    );
    const hardwareFailures = new HardwareFailures();
    const video = videoStream();
    const { ctx, fallbacks } = context(runner, { hardwareFailures });
    const frame = await extractFrame(clip, at, ctx, { probe: probeOf(clip, video) });
    expect(!frame.ok && frame.error.code).toBe('media.decode_failed');
    expect(!frame.ok && frame.error.detail).toMatch(
      /exited with code 1[\s\S]*VideoToolbox failed first: Invalid data/,
    );
    expect(hardwareFailures.recall(video)).toBeUndefined();
    expect(fallbacks).toEqual([]);
  });

  it('a time the probe puts past the end fails before anything runs', async () => {
    const { runner, calls } = fakeRunner(async () => ok(output()));
    const probe = probeOf(clip, videoStream({ duration: { value: 60060, rate: 30000 } }));
    const frame = await extractFrame(clip, { value: 3, rate: 1 }, context(runner).ctx, { probe });
    // params name the file for a window; the full path is only in detail.
    expect(!frame.ok && frame.error).toMatchObject({
      code: 'media.decode_failed',
      params: { name: 'clip.mp4' },
      detail: `${realpathSync(clip)}: no frame at 3.000000 s: the video ends at 2.002000 s`,
    });
    expect(calls).toEqual([]);
  });

  it.each([
    ['a codec VideoToolbox lacks', {}, videoStream({ codec: 'vp8' }), 'codec_unsupported'],
    ['a platform without a hardware backend', { platform: 'freebsd' }, videoStream(), 'no_hardware_backend'],
  ] as const)('%s decodes in software once, with the reason', async (_name, extra, video, code) => {
    const { runner, calls } = fakeRunner(async () => {
      throw new Error('no hardware run expected');
    });
    const { ctx, fallbacks } = context(runner, extra);
    const frame = await extractFrame(clip, at, ctx, { probe: probeOf(clip, video) });
    expect(frame.ok && frame.value.backend).toBe('software');
    expect(frame.ok && frame.value.fallbackReason?.code).toBe(code);
    expect(calls).toHaveLength(1);
    expect(fallbacks.map((f) => f.reason.code)).toEqual([code]);
  });

  it('a probe with no video stream is media.decode_failed before anything runs', async () => {
    const { runner, calls } = fakeRunner(async () => ok(output()));
    const frame = await extractFrame(clip, at, context(runner).ctx, { probe: probeOf(clip, null) });
    expect(!frame.ok && frame.error).toMatchObject({
      code: 'media.decode_failed',
      params: { name: 'clip.mp4' },
      detail: `${realpathSync(clip)}: no video stream`,
    });
    expect(calls).toEqual([]);
  });
});

describe('MediaService', () => {
  it('counts software fallbacks by operation and reason', async () => {
    const { runner } = fakeRunner(async () => ok(output({ exitCode: 1, stderrTail: VT_FAILED })));
    const seen: BackendFallback[] = [];
    const service = createMediaService({
      resolver: {
        resolve: async () => ok({ ...BINARIES, ffmpegInfo: BUILD, ffprobeInfo: BUILD, verified: false }),
      },
      runner,
      onBackendFallback: (f) => seen.push(f),
    });
    const vp8 = probeOf(clip, videoStream({ codec: 'vp8' }));
    await service.extractFrame(clip, at, { probe: vp8 });
    await service.extractFrame(clip, at, { probe: vp8, decode: 'software' });
    // VideoToolbox has no VP8 decoder; NVDEC has one, and this runner fails every hardware run (its device trial,
    // which names no -hwaccel, passes); elsewhere there is no row.
    const first =
      process.platform === 'darwin'
        ? 'decode:codec_unsupported'
        : process.platform === 'linux'
          ? 'decode:hardware_failed'
          : 'decode:no_hardware_backend';
    expect(service.fallbackCounts()).toEqual({ [first]: 1, 'decode:requested': 1 });
    expect(seen).toHaveLength(2);
  });
});
