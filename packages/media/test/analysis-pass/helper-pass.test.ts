// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-V3: the analysis pass over a decode service, with a fake service and a fake FFmpeg. The service's frames
 * go through a CPU FFmpeg reading raw NV12 from a FIFO, the shot model's RGB stream (IX2-C3) tapped there as on
 * FFmpeg's route; a decline before any frame (gray or stream) goes on to FFmpeg's own decode, a failure after
 * frames went out fails retryably and leaves the file to FFmpeg (from then on for a file the service can't read as
 * FFmpeg does, for the next pass only otherwise: IX2-F16); a cancel is a cancel, and the lease goes back only when
 * the service lets go of its session (IX2-F4).
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err } from '@taalcut/core';
import {
  countedContext,
  createDecodeTally,
  MediaCancelled,
  runAnalysisPass,
  SidecarFailed,
  SidecarRejected,
  type AnalysisPassOptions,
  type MediaContext,
  type PassFrame,
  type RgbBatch,
} from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countingGate,
  fakeFfmpeg,
  FAKE_HELPER_PID,
  fakeService,
  STREAM_FRAME_BYTES,
  writesSets,
  type FakeFfmpeg,
  type PassScript,
} from '../helpers/fake-decode';
import { videoPlan } from '../helpers/video-plan';

const binaries = { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' } as const;
const plan = videoPlan({ width: 1280, height: 720, displayWidth: 1280, displayHeight: 720 }, false, 'darwin');
const GRAY = 256 * 144;

/**
 * A pass the caller cancels once the service has it, answered as a cancel: on a timer instead, a slow start
 * (mkfifo is a real process, IX3-F4) could cancel before the service was asked, and this fake never answers then.
 */
const cancelledOnceAsked =
  (abort: AbortController): PassScript =>
  (_request, signal) =>
    new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve(err(MediaCancelled())), { once: true });
      abort.abort();
    });

const readerCall = (ffmpeg: FakeFfmpeg) => ffmpeg.calls.find((call) => call.args.includes('-pixel_format'));
const decodeCall = (ffmpeg: FakeFfmpeg) => ffmpeg.calls.find((call) => call.args.includes('-hwaccel'));

describe('the analysis pass on a decode service', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-helper-pass-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const context = (ffmpeg: FakeFfmpeg, gate = countingGate()) => {
    const tally = createDecodeTally('/clip.mp4');
    const ctx: MediaContext = countedContext(
      { binaries, runner: ffmpeg.runner, hardwareSessions: gate },
      tally,
    );
    return { ctx, tally, gate };
  };

  it('decodes in the service and reads its frames with a CPU FFmpeg', async () => {
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY });
    const { ctx, tally, gate } = context(ffmpeg);
    const service = fakeService(writesSets(60));
    const seen: PassFrame[] = [];
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      coarseEvery: 10,
      decodeService: service,
      onFrame: (frame) => seen.push(frame),
      frameSets: [{ set: 'ocr', size: { longSide: 640 }, format: 'gray8', every: 15, maxFrames: 3 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.frames).toBe(60);
    expect(result.value.fine).toHaveLength(60);
    expect(result.value.coarse.map((s) => s.index).slice(0, 3)).toEqual([0, 10, 20]);
    expect(result.value.black).toEqual([{ startSec: 1, endSec: 1.5 }]);
    expect(seen.map((f) => f.index).slice(0, 2)).toEqual([0, 1]);
    expect(seen[0]).toMatchObject({ width: 256, height: 144 });
    const [file] = result.value.files;
    expect(file?.slots.map((s) => s.index)).toEqual([0, 15, 30]);
    expect(file).toMatchObject({ width: 640, height: 360, format: 'gray8' });
    const [request] = service.requests;
    expect(request).toMatchObject({ rotation: 0, range: 'video', rate: { num: 30, den: 1 } });
    expect(request?.analysis).toMatchObject({ width: 256, height: 144 });
    expect(request?.sets[0]).toMatchObject({
      width: 640,
      height: 360,
      every: 15,
      maxFrames: 3,
      format: 'gray8',
    });
    const reader = readerCall(ffmpeg)?.args ?? [];
    expect(reader.join(' ')).toContain('-f rawvideo -pixel_format nv12 -video_size 256x144 -framerate 30/1');
    expect(reader.join(' ')).toContain('-color_range tv');
    expect(decodeCall(ffmpeg)).toBeUndefined();
    expect(gate.taken).toEqual([1]);
    expect(gate.held()).toBe(0);
    // The helper's pid is on the lease before the pass goes out, until it lets go (IX3-F7).
    expect(gate.events).toEqual([`adopt ${FAKE_HELPER_PID}`, 'release']);
    expect(tally.snapshot()).toMatchObject({ fullDecodes: 1, originalFullDecodes: 1, partialDecodes: 0 });
    // Only the kept frame file is left: the FIFO and the scene files are gone.
    expect(await readdir(dir)).toEqual([file?.path.slice(dir.length + 1)]);
  });

  it('decodes a window and counts it as a partial decode', async () => {
    const ffmpeg = fakeFfmpeg({ frames: 30, frameBytes: GRAY });
    const { ctx, tally } = context(ffmpeg);
    const service = fakeService(writesSets(30));
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: service,
      window: { from: 30, frames: 30 },
      detectMinSeconds: 0,
    });
    expect(result.ok && result.value.frames).toBe(60);
    expect(result.ok && result.value.fine[0]?.index).toBe(30);
    expect(result.ok && result.value.black).toEqual([{ startSec: 2, endSec: 2.5 }]);
    expect(service.requests[0]?.window).toEqual({ from: 30, frames: 30 });
    expect(readerCall(ffmpeg)?.args.join(' ')).toContain('blackdetect=d=0');
    expect(tally.snapshot()).toMatchObject({ fullDecodes: 0, partialDecodes: 1 });
  });

  it('gives each detector its own minimum on the reader, as on FFmpeg’s route (IX3-D2)', async () => {
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY });
    const { ctx } = context(ffmpeg);
    const service = fakeService(writesSets(60));
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: service,
      detectMinSeconds: { black: 0 },
    });
    expect(result.ok).toBe(true);
    expect(service.requests).toHaveLength(1);
    const reader = readerCall(ffmpeg)?.args.join(' ') ?? '';
    expect(reader).toContain('blackdetect=d=0,freezedetect');
    expect(reader).not.toContain('freezedetect=d=');
  });

  it('goes on to FFmpeg when the service declines before any frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY, blockReader: true });
    const { ctx, gate } = context(ffmpeg);
    const service = fakeService(async () =>
      err(SidecarRejected({ helperCode: 'decode.unsupported' }, { detail: 'mjpeg' })),
    );
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: service,
      onFrame: () => {},
    });
    expect(result.ok && result.value.fine).toHaveLength(60);
    expect(decodeCall(ffmpeg)).toBeDefined();
    expect(gate.held()).toBe(0);
    expect(warn.mock.calls.some(([line]) => String(line).includes('decode.unsupported'))).toBe(true);
    expect(service.avoided('/clip.mp4')).toBeUndefined();
  });

  it('fails retryably after frames went out, and leaves the file to FFmpeg from then on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY, blockReader: true, streamFirst: 3 });
    const { ctx } = context(ffmpeg);
    const service = fakeService(async () => err(SidecarRejected({ helperCode: 'decode.off_grid' })));
    const options: AnalysisPassOptions = { dir, decodeService: service, onFrame: () => {} };
    const first = await runAnalysisPass('/clip.mp4', plan, ctx, options);
    expect(!first.ok && SidecarFailed.is(first.error) && first.error.retryable).toBe(true);
    expect(!first.ok && first.error.params).toEqual({ helperCode: 'decode.off_grid' });
    expect(service.avoided('/clip.mp4')).toBe('decode.off_grid');
    const again = await runAnalysisPass('/clip.mp4', plan, ctx, options);
    expect(again.ok).toBe(true);
    expect(service.requests).toHaveLength(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it('returns a cancel as a cancel, with the lease given back', async () => {
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY, blockReader: true });
    const { ctx, gate } = context(ffmpeg);
    const abort = new AbortController();
    const service = fakeService(cancelledOnceAsked(abort));
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: service,
      signal: abort.signal,
    });
    expect(!result.ok && MediaCancelled.is(result.error)).toBe(true);
    expect(decodeCall(ffmpeg)).toBeUndefined();
    expect(gate.held()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps the lease while a cancelled pass the service did not answer may still hold its session', async () => {
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY, blockReader: true });
    const { ctx, gate } = context(ffmpeg);
    const abort = new AbortController();
    // The grace ran out: the pass settles cancelled, but the helper never answered (stuck in the decoder).
    const service = fakeService(cancelledOnceAsked(abort), { holds: true });
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: service,
      signal: abort.signal,
    });
    expect(!result.ok && MediaCancelled.is(result.error)).toBe(true);
    expect(gate.held()).toBe(1);
    expect(service.holding).toHaveLength(1);
    // Its late reply (or its exit) gives the session, and so the lease, back.
    service.holding[0]?.();
    expect(gate.held()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  /** The model's stream: every frame at 48×27, collected. */
  const rgbStream = () => {
    const batches: RgbBatch[] = [];
    const frames = () => batches.reduce((n, b) => n + b.count, 0);
    return {
      batches,
      frames,
      stream: { width: 48, height: 27, every: 1, onFrames: async (b: RgbBatch) => void batches.push(b) },
    };
  };

  it('taps the model’s stream off the frames the service decoded, in colour', async () => {
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY });
    const { ctx } = context(ffmpeg);
    const seen = rgbStream();
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: fakeService(writesSets(60)),
      onFrame: () => {},
      rgbStream: seen.stream,
    });
    expect(result.ok && result.value.frames).toBe(60);
    expect(decodeCall(ffmpeg)).toBeUndefined();
    expect(seen.frames()).toBe(60);
    expect(seen.batches[0]).toMatchObject({ index: 0, every: 1, width: 48, height: 27 });
    expect(seen.batches[0]?.data.length).toBe((seen.batches[0]?.count ?? 0) * STREAM_FRAME_BYTES);
    const args = readerCall(ffmpeg)?.args ?? [];
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    // The analysis path converts to gray after the split, so the tap reads the NV12 frames; the graph's scales on
    // one thread, so the frames repeat (IX2-F15).
    expect(graph).toMatch(
      /^sws_flags=bicubic:threads=1;\[0:v\]split=2\[s0\]\[s1\];\[s0\]scale=threads=1,scdet=[^;]*\[o0\];\[s1\]scale=48:27:flags=bicubic,format=rgb24\[o1\]$/,
    );
    expect(args.join(' ')).toContain('-map [o1] -fps_mode passthrough -f rawvideo -pix_fmt rgb24');
    expect(await readdir(dir)).toEqual([]);
  });

  it('hands the stream over once when the service declines: FFmpeg’s decode streams the file', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY, blockReader: true });
    const { ctx } = context(ffmpeg);
    const seen = rgbStream();
    const service = fakeService(async () => err(SidecarRejected({ helperCode: 'decode.unsupported' })));
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: service,
      onFrame: () => {},
      rgbStream: seen.stream,
    });
    expect(result.ok).toBe(true);
    expect(decodeCall(ffmpeg)).toBeDefined();
    expect(seen.frames()).toBe(60);
    expect(seen.batches[0]?.index).toBe(0);
  });

  it('after a failure that is the read’s, sends only the next pass to FFmpeg and holds no read off (IX2-F16)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY, blockReader: true, streamFirst: 3 });
    const { ctx } = context(ffmpeg);
    for (const code of ['decode.failed', 'decode.output_closed']) {
      const service = fakeService(async () => err(SidecarFailed({ helperCode: code })));
      const options: AnalysisPassOptions = { dir, decodeService: service, onFrame: () => {} };
      const first = await runAnalysisPass('/clip.mp4', plan, ctx, options);
      expect(!first.ok && SidecarFailed.is(first.error) && first.error.retryable).toBe(true);
      // Not the file's fault: frame reads still ask the service.
      expect(service.avoided('/clip.mp4')).toBeUndefined();
      const fallback = await runAnalysisPass('/clip.mp4', plan, ctx, options);
      expect(fallback.ok).toBe(true);
      expect(service.requests).toHaveLength(1);
      // Once: the pass after that asks the service again.
      await runAnalysisPass('/clip.mp4', plan, ctx, options);
      expect(service.requests).toHaveLength(2);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('counts stream frames handed over as frames gone out: a later failure is not a decline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ffmpeg = fakeFfmpeg({ frames: 60, frameBytes: GRAY, blockReader: true, rgbFirst: 20 });
    const { ctx } = context(ffmpeg);
    const seen = rgbStream();
    const service = fakeService(async () => {
      // Fails once the stream's reader has handed the first frames over.
      while (seen.frames() < 20) await new Promise((resolve) => setTimeout(resolve, 10));
      return err(SidecarRejected({ helperCode: 'decode.off_grid' }));
    });
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: service,
      rgbStream: seen.stream,
    });
    expect(!result.ok && SidecarFailed.is(result.error)).toBe(true);
    expect(decodeCall(ffmpeg)).toBeUndefined();
    expect(seen.frames()).toBe(20);
    expect(service.avoided('/clip.mp4')).toBe('decode.off_grid');
    expect(await readdir(dir)).toEqual([]);
  });

  it('fails when the analysis filters read fewer frames than the service wrote', async () => {
    const ffmpeg = fakeFfmpeg({ frames: 50, frameBytes: GRAY });
    const { ctx } = context(ffmpeg);
    const result = await runAnalysisPass('/clip.mp4', plan, ctx, {
      dir,
      decodeService: fakeService(writesSets(60)),
    });
    expect(!result.ok && SidecarFailed.is(result.error)).toBe(true);
    expect(!result.ok && result.error.detail).toContain('50 of 60');
  });
});
