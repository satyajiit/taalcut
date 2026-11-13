// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-G3, with no FFmpeg and no helper: `decodeFrameSets` with a decode service reads every set from one service
 * request under one hardware session lease, converts the NV12 in one CPU FFmpeg run tagged with the stream's
 * colour, and indexes the frames the service says it wrote; a picture the service would not read as FFmpeg does,
 * a service failure, a reply that leaves out a frame asked for, or a conversion that fails, goes to FFmpeg's seeks
 * (a file the service can't read as FFmpeg does stays with FFmpeg; IX2-F16); a cancel is a cancel, and the lease
 * stays taken until the service has let go of its session (IX2-F4). The bytes themselves are pinned against FFmpeg
 * by service-parity.test.ts.
 */
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from '@taalcut/core';
import {
  bytesPerFrame,
  countedContext,
  createDecodeTally,
  decodeFrameSets,
  FfmpegFailed,
  MediaCancelled,
  SidecarFailed,
  SidecarRejected,
  type DecodeFramesRequest,
  type FrameSetRequest,
  type MediaContext,
  type NormalisationPlan,
  type ProcessOutput,
  type ProcessRunner,
} from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { colourTags, nv12ConvertArgs } from '../../src/frame-sets/nv12-convert';
import { countingGate, FAKE_HELPER_PID, fakeService, type FramesScript } from '../helpers/fake-decode';
import { HLG_STREAM, hdPlan } from '../helpers/video-plan';

const done: ProcessOutput = {
  exitCode: 0,
  signal: null,
  stdout: Buffer.alloc(0),
  stderrTail: '',
  durationMs: 1,
};

interface Call {
  readonly args: readonly string[];
}

/** An FFmpeg run's output files: the path after each `-map`'s output options. */
const outputsOf = (args: readonly string[]) =>
  args.flatMap((arg, i) =>
    arg === '-map' ? [args.slice(i).find((a) => /\.(raw|mjpeg)$/.test(a)) ?? ''] : [],
  );

/**
 * An FFmpeg: a seek (a filter graph: FFmpeg's own route) fails or writes empty files; a conversion (raw NV12 in)
 * writes as many frames per output as its NV12 input holds, in the output's format, or fails as `convert` says.
 */
function fakeFfmpeg(
  calls: Call[],
  seeks: 'fail' | 'ok' = 'fail',
  convert: 'ok' | 'fail' | 'cancel' = 'ok',
): ProcessRunner {
  return async (_command, args) => {
    calls.push({ args });
    const outputs = outputsOf(args);
    if (args.includes('-filter_complex')) {
      if (seeks === 'fail') return err(FfmpegFailed({ exitCode: 1 }, { detail: 'seek' }));
      for (const out of outputs) await writeFile(out, Buffer.alloc(0));
      return ok(done);
    }
    const sizes = args.flatMap((arg, i) => (arg === '-video_size' ? [args[i + 1] ?? ''] : []));
    const inputs = args.flatMap((arg, i) =>
      arg === '-i' ? [(args[i + 1] ?? '').replace(/^file:/, '')] : [],
    );
    for (const [n, out] of outputs.entries()) {
      const [width = 0, height = 0] = (sizes[n] ?? '0x0').split('x').map(Number);
      const count = (await stat(inputs[n] ?? '')).size / (width * height * 1.5);
      const gray = args[args.indexOf(out) - 1] === 'gray';
      const jpeg = Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);
      const each = bytesPerFrame(gray ? 'gray8' : 'rgb24', width, height);
      // Half the output written, then the failure: the caller removes what's there.
      await writeFile(
        out,
        out.endsWith('.mjpeg') ? Buffer.concat([jpeg, jpeg]) : Buffer.alloc(each * count, 5),
      );
    }
    if (convert === 'fail') return err(FfmpegFailed({ exitCode: 1 }, { detail: 'No space left on device' }));
    if (convert === 'cancel') return err(MediaCancelled());
    return ok(done);
  };
}

/** A service that writes every frame asked for as NV12 and says so. */
const writesAsked: FramesScript = async (request) => {
  for (const set of request.sets)
    await writeFile(set.path, Buffer.alloc(set.width * set.height * 1.5 * set.frames.length, 3));
  return ok({ written: request.sets.map((set) => set.frames), decoded: 40, reads: 2, ms: 12 });
};

/** A service whose reply leaves out each set's last frame asked for (a read that decoded no picture). */
const leavesOneOut: FramesScript = async (request) => {
  for (const set of request.sets)
    await writeFile(set.path, Buffer.alloc(set.width * set.height * 1.5 * (set.frames.length - 1), 3));
  return ok({ written: request.sets.map((set) => set.frames.slice(0, -1)), decoded: 40, reads: 2, ms: 12 });
};

/** The service's pass: never asked here. */
const noPass = async () => ok({ frames: 0, sets: [], ms: 0 });

const SETS: FrameSetRequest[] = [
  {
    set: 'embed',
    size: { width: 768, height: 384, exact: true },
    format: 'rgb24',
    frames: [90, 3, 3, 400, 7],
  },
  { set: 'gray', size: { longSide: 256 }, format: 'gray8', frames: [10, 20] },
];

describe('frame sets through the decode service', () => {
  let dir: string;
  let calls: Call[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-service-sets-'));
    calls = [];
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const context = (runner: ProcessRunner, gate = countingGate()): MediaContext => ({
    binaries: { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe', source: 'dev-build' },
    runner,
    hardwareSessions: gate,
  });

  it('reads every set in one request under one lease, converts once and indexes what was written', async () => {
    const service = fakeService(noPass, { frames: writesAsked });
    const gate = countingGate();
    const plan = hdPlan({ codec: 'hevc', frameCount: 300, duration: { value: 10, rate: 1 } });
    const read = await decodeFrameSets('/clip.mov', plan, context(fakeFfmpeg(calls), gate), {
      sets: SETS,
      dir,
      decodeService: service,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const [request] = service.frameRequests as [DecodeFramesRequest];
    expect(service.frameRequests).toHaveLength(1);
    expect(request).toMatchObject({
      path: '/clip.mov',
      rate: { num: 30, den: 1 },
      rotation: 0,
      range: 'video',
    });
    expect(request.gapSeconds).toBe(2);
    // Distinct, ascending, past the end left out; each set at the size FFmpeg's route scales it to.
    expect(request.sets.map((s) => [s.width, s.height, s.frames])).toEqual([
      [768, 384, [3, 7, 90]],
      [256, 144, [10, 20]],
    ]);
    expect(gate.taken).toEqual([1]);
    expect(gate.held()).toBe(0);
    // The helper's pid is on the lease before the read goes out, until it lets go (IX3-F7).
    expect(gate.events).toEqual([`adopt ${FAKE_HELPER_PID}`, 'release']);
    // One CPU FFmpeg (no hardware decode), both sets.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).not.toContain('-hwaccel');
    expect(read.value.map((f) => [f.set, f.width, f.height, f.slots.map((s) => s.index)])).toEqual([
      ['embed', 768, 384, [3, 7, 90]],
      ['gray', 256, 144, [10, 20]],
    ]);
    // The service's NV12 is gone; the frame files stay for the caller.
    expect((await readdir(dir)).filter((name) => name.endsWith('.nv12'))).toEqual([]);
  });

  it('leaves pictures it would not read as FFmpeg does to FFmpeg, without asking the service', async () => {
    const service = fakeService(noPass, { frames: writesAsked });
    for (const plan of [
      hdPlan(HLG_STREAM),
      hdPlan({ codec: 'hevc' }, 'linux'),
      hdPlan({ vfrHint: true }),
      hdPlan({ width: 640, height: 360, displayWidth: 640, displayHeight: 360 }),
    ] as NormalisationPlan[]) {
      const read = await decodeFrameSets('/clip.mov', plan, context(fakeFfmpeg(calls)), {
        sets: [{ set: 'gray', size: { longSide: 640 }, format: 'gray8', frames: [1] }],
        dir,
        decodeService: service,
      });
      // FFmpeg's seek ran (and the fake failed it).
      expect(read.ok).toBe(false);
      expect(calls.at(-1)?.args).toContain('-filter_complex');
    }
    // A JPEG set: its header carries the stream's sample aspect ratio, which only FFmpeg's route knows.
    const jpeg = await decodeFrameSets('/clip.mov', hdPlan({ codec: 'hevc' }), context(fakeFfmpeg(calls)), {
      sets: [{ set: 'describe', size: { longSide: 400 }, format: 'jpeg', frames: [1] }],
      dir,
      decodeService: service,
    });
    expect(jpeg.ok).toBe(false);
    expect(calls.at(-1)?.args).toContain('-filter_complex');
    expect(service.frameRequests).toHaveLength(0);
  });

  it('leaves every frame read to FFmpeg when the service takes only the analysis pass (IX2-F14)', async () => {
    const service = fakeService(noPass, { frames: writesAsked });
    const passOnly = { ...service, tasks: ['pass'] as const };
    const read = await decodeFrameSets('/clip.mov', hdPlan({ codec: 'hevc' }), context(fakeFfmpeg(calls)), {
      sets: [{ set: 'gray', size: { longSide: 640 }, format: 'gray8', frames: [1] }],
      dir,
      decodeService: passOnly,
    });
    expect(read.ok).toBe(false);
    expect(calls.at(-1)?.args).toContain('-filter_complex');
    expect(service.frameRequests).toHaveLength(0);
  });

  it('goes on to FFmpeg when the service fails, and keeps a file it could not read with FFmpeg', async () => {
    const offGrid: FramesScript = async () => err(SidecarRejected({ helperCode: 'decode.off_grid' }));
    const service = fakeService(noPass, { frames: offGrid });
    const plan = hdPlan({ codec: 'hevc' });
    const options = { sets: SETS, dir, decodeService: service };
    const first = await decodeFrameSets('/clip.mov', plan, context(fakeFfmpeg(calls, 'ok')), options);
    expect(first.ok).toBe(true);
    expect(calls.some((call) => call.args.includes('-hwaccel'))).toBe(true);
    expect((await readdir(dir)).filter((name) => name.endsWith('.nv12'))).toEqual([]);
    expect(service.avoided('/clip.mov')).toBe('decode.off_grid');
    await decodeFrameSets('/clip.mov', plan, context(fakeFfmpeg(calls, 'ok')), options);
    expect(service.frameRequests).toHaveLength(1);
    // A crash is not the file's fault: FFmpeg reads this time, the service is asked again next time.
    const crashed: FramesScript = async () => err(SidecarFailed(undefined, { detail: 'helper exited' }));
    const flaky = fakeService(noPass, { frames: crashed });
    const third = await decodeFrameSets('/other.mov', plan, context(fakeFfmpeg(calls, 'ok')), {
      ...options,
      decodeService: flaky,
    });
    expect(third.ok).toBe(true);
    expect(flaky.avoided('/other.mov')).toBeUndefined();
  });

  it('goes on to FFmpeg when the reply leaves out a frame asked for, not a short set (IX2-F16)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = fakeService(noPass, { frames: leavesOneOut });
    const plan = hdPlan({ codec: 'hevc', frameCount: 300, duration: { value: 10, rate: 1 } });
    const read = await decodeFrameSets('/clip.mov', plan, context(fakeFfmpeg(calls, 'ok')), {
      sets: SETS,
      dir,
      decodeService: service,
    });
    expect(read.ok).toBe(true);
    // No conversion: FFmpeg's seeks read every set.
    expect(calls.every((call) => call.args.includes('-filter_complex'))).toBe(true);
    expect(warn.mock.calls.some(([line]) => String(line).includes('left out 2 frames asked for'))).toBe(true);
    expect(service.avoided('/clip.mov')).toBeUndefined();
    expect((await readdir(dir)).filter((name) => name.endsWith('.nv12'))).toEqual([]);
  });

  it('goes on to FFmpeg when the conversion fails, and returns a cancel during it as it is (IX2-F16)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = fakeService(noPass, { frames: writesAsked });
    const tally = createDecodeTally('/clip.mov');
    const plan = hdPlan({ codec: 'hevc' });
    const ctx = countedContext(context(fakeFfmpeg(calls, 'ok', 'fail')), tally);
    const read = await decodeFrameSets('/clip.mov', plan, ctx, { sets: SETS, dir, decodeService: service });
    expect(read.ok).toBe(true);
    const [convert, ...seeks] = calls;
    expect(convert?.args).not.toContain('-filter_complex');
    expect(seeks.length > 0 && seeks.every((call) => call.args.includes('-hwaccel'))).toBe(true);
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(
      lines.some((line) => line.includes("frames didn't convert (media.ffmpeg_failed); FFmpeg seeks")),
    ).toBe(true);
    // Neither the conversion's outputs nor the NV12 are left; the service read isn't counted or called used.
    const left = await readdir(dir);
    expect(left.filter((name) => outputsOf(convert?.args ?? []).some((out) => out.endsWith(name)))).toEqual(
      [],
    );
    expect(left.filter((name) => name.endsWith('.nv12'))).toEqual([]);
    expect(lines.some((line) => line.includes('reading with'))).toBe(false);
    expect(tally.snapshot().partialDecodes).toBe(seeks.length);
    expect(service.avoided('/clip.mov')).toBeUndefined();

    calls.length = 0;
    const options = { sets: SETS, dir, decodeService: service };
    const cancelled = await decodeFrameSets(
      '/clip.mov',
      plan,
      context(fakeFfmpeg(calls, 'ok', 'cancel')),
      options,
    );
    expect(!cancelled.ok && MediaCancelled.is(cancelled.error)).toBe(true);
    expect(calls.some((call) => call.args.includes('-filter_complex'))).toBe(false);
  });

  it('returns a cancel as it is, with no FFmpeg, and keeps the lease until the service lets go', async () => {
    const cancelled: FramesScript = async () => err(MediaCancelled());
    const answered = fakeService(noPass, { frames: cancelled });
    const gate = countingGate();
    const options = { sets: SETS, dir, decodeService: answered };
    const plan = hdPlan({ codec: 'hevc' });
    const read = await decodeFrameSets('/clip.mov', plan, context(fakeFfmpeg(calls), gate), options);
    expect(!read.ok && MediaCancelled.is(read.error)).toBe(true);
    expect(gate.held()).toBe(0);
    expect(calls).toHaveLength(0);
    // A cancel the service didn't answer (IX2-F4): the session may still be open, so the lease stays taken.
    const unanswered = fakeService(noPass, { frames: cancelled, holds: true });
    const held = await decodeFrameSets('/clip.mov', plan, context(fakeFfmpeg(calls), gate), {
      ...options,
      decodeService: unanswered,
    });
    expect(!held.ok && MediaCancelled.is(held.error)).toBe(true);
    expect(gate.held()).toBe(1);
    unanswered.holding[0]?.();
    expect(gate.held()).toBe(0);
    expect((await readdir(dir)).filter((name) => name.endsWith('.nv12'))).toEqual([]);
  });
});

describe('the NV12 conversion', () => {
  it('tags the frames as the decoder does and writes each set as FFmpeg would', () => {
    const plan = hdPlan({
      codec: 'hevc',
      colour: { range: 'pc', space: 'bt709', primaries: 'bt709', transfer: 'unknown' },
    });
    const tags = colourTags(plan, 'full');
    expect(tags).toEqual(['-color_range', 'pc', '-colorspace', 'bt709', '-color_primaries', 'bt709']);
    expect(colourTags(hdPlan({ colour: { space: 'bt709 ; rm' } }), 'video')).toEqual(['-color_range', 'tv']);
    const args = nv12ConvertArgs(
      [
        { input: { path: '/d/a.nv12', width: 768, height: 384 }, format: 'rgb24', output: '/d/a.raw' },
        { input: { path: '/d/b.nv12', width: 256, height: 144 }, format: 'gray8', output: '/d/b.raw' },
      ],
      tags,
    );
    expect(args.filter((arg) => arg === '-i')).toHaveLength(2);
    expect(args.join(' ')).toContain('-f rawvideo -pixel_format nv12 -video_size 768x384');
    // One thread per output: FFmpeg's sliced conversion of tagged NV12 isn't repeatable at some sizes.
    expect(args.join(' ')).toContain(
      '-map 0:v:0 -fps_mode passthrough -filter_threads 1 -f rawvideo -pix_fmt rgb24 /d/a.raw',
    );
    expect(args.join(' ')).toContain(
      '-map 1:v:0 -fps_mode passthrough -filter_threads 1 -f rawvideo -pix_fmt gray /d/b.raw',
    );
    expect(args).not.toContain('-hwaccel');
  });
});
