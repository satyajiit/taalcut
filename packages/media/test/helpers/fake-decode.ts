// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fakes for the analysis pass's decode-service route (IX2-V3), with no FFmpeg and no helper: a runner that
 * makes the FIFO it is asked for (the pass holds its read end open, IX3-F4) and plays an FFmpeg that writes
 * `frames` scene scores and gray frames (either route's), and a decode service whose pass is a script.
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { err, ok, type AsyncResult } from '@taalcut/core';
import {
  MediaCancelled,
  SidecarRejected,
  type DecodeFramesReport,
  type DecodeFramesRequest,
  type DecodePassReport,
  type DecodePassRequest,
  type DecodeService,
  type HardwareSessionGate,
  type ProcessOutput,
  type ProcessRunner,
  type RunOptions,
} from '@taalcut/media';

export interface RunnerCall {
  readonly command: string;
  readonly args: readonly string[];
}

const output = (exitCode: number): ProcessOutput => ({
  exitCode,
  signal: null,
  stdout: Buffer.alloc(0),
  stderrTail: '',
  durationMs: 1,
});

/** The scene file `metadata=mode=print` writes for `count` frames. */
const sceneText = (count: number) =>
  Array.from(
    { length: count },
    (_, n) => `frame:${n} pts:${n} pts_time:${n / 30}\nlavfi.scd.mafd=1\nlavfi.scd.score=${n % 7}\n`,
  ).join('');

/** The metadata files a graph names, in order (fine first, then coarse). */
const metadataFiles = (args: readonly string[]): string[] => {
  const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
  return [...graph.matchAll(/metadata=mode=print:file=([^,[;]+)/g)].map((match) => match[1] ?? '');
};

export interface FakeFfmpeg {
  readonly runner: ProcessRunner;
  readonly calls: RunnerCall[];
}

/** The RGB stream's file an FFmpeg run writes (`-pix_fmt rgb24 <path>`), if it has one. */
const rgbStreamFile = (args: readonly string[]): string | undefined => {
  const at = args.findIndex((arg, i) => arg === 'rgb24' && args[i - 1] === '-pix_fmt');
  return at > 0 ? args[at + 1] : undefined;
};

/** 48×27 RGB24, the shot model's stream (IX2-C3). */
export const STREAM_FRAME_BYTES = 48 * 27 * 3;

/**
 * An FFmpeg that writes `frames` scores to each metadata file (every `n`-th for a branch picking every n),
 * `frames` gray frames to stdout, `frames` 48×27 frames to an RGB stream's file and a black interval to
 * stderr. `blockReader`: an FFmpeg reading raw video waits for its signal (a FIFO no one opened), after
 * streaming `streamFirst` gray frames and `rgbFirst` RGB stream frames.
 */
export function fakeFfmpeg(spec: {
  readonly frames: number;
  readonly frameBytes: number;
  readonly blockReader?: boolean;
  readonly streamFirst?: number;
  readonly rgbFirst?: number;
}): FakeFfmpeg {
  const calls: RunnerCall[] = [];
  const runner: ProcessRunner = async (command, args, options: RunOptions = {}) => {
    calls.push({ command, args });
    if (command === '/usr/bin/mkfifo') {
      await promisify(execFile)(command, [...args]);
      return ok(output(0));
    }
    const reader = args.includes('rawvideo') && args.includes('-pixel_format');
    const rgb = rgbStreamFile(args);
    if (reader && spec.blockReader) {
      for (let n = 0; n < (spec.streamFirst ?? 0); n++) options.onStdout?.(Buffer.alloc(spec.frameBytes, n));
      if (rgb && spec.rgbFirst) await writeFile(rgb, Buffer.alloc(spec.rgbFirst * STREAM_FRAME_BYTES, 9));
      return new Promise((resolve) => {
        const stop = () => resolve(err(MediaCancelled()));
        if (options.signal?.aborted) stop();
        options.signal?.addEventListener('abort', stop, { once: true });
      });
    }
    const [fine, coarse] = metadataFiles(args);
    if (fine) await writeFile(fine, sceneText(spec.frames));
    if (coarse) await writeFile(coarse, sceneText(Math.ceil(spec.frames / 10)));
    for (let n = 0; n < spec.frames; n++) options.onStdout?.(Buffer.alloc(spec.frameBytes, n));
    if (rgb) await writeFile(rgb, Buffer.alloc(spec.frames * STREAM_FRAME_BYTES, 9));
    options.onStderr?.(Buffer.from('[blackdetect @ 0x1] black_start:1 black_end:1.5 black_duration:0.5\n'));
    return ok(output(0));
  };
  return { runner, calls };
}

export type PassScript = (request: DecodePassRequest, signal?: AbortSignal) => AsyncResult<DecodePassReport>;

export type FramesScript = (
  request: DecodeFramesRequest,
  signal?: AbortSignal,
) => AsyncResult<DecodeFramesReport>;

export interface FakeService extends DecodeService {
  readonly requests: DecodePassRequest[];
  readonly frameRequests: DecodeFramesRequest[];
  /** With `holds`: the requests the service hasn't let go of yet; calling one is its late reply or its exit. */
  readonly holding: (() => void)[];
}

/** A service that takes no frame reads: the helper's answer for a stream it can't read. */
export const declinesFrames: FramesScript = async () =>
  err(SidecarRejected({ helperCode: 'decode.unsupported' }));

export interface FakeServiceOptions {
  /** Its frame reads; default `declinesFrames`. */
  readonly frames?: FramesScript;
  readonly holds?: boolean;
  /** The helper's pid it gives `onSend` before each request; default `FAKE_HELPER_PID`. */
  readonly pid?: number;
}

export const FAKE_HELPER_PID = 4242;

/**
 * A service whose pass is `script` and whose frame reads are `options.frames`. It lets go of each request when the
 * script settles (its reply), or with `holds` only when the test calls the request's entry in `holding` (a cancel
 * it didn't answer, IX2-F4).
 */
export function fakeService(script: PassScript, options: FakeServiceOptions = {}): FakeService {
  const requests: DecodePassRequest[] = [];
  const frameRequests: DecodeFramesRequest[] = [];
  const holding: (() => void)[] = [];
  const settle = <T>(result: T, onLetGo: (() => void) | undefined): T => {
    const letGo = () => onLetGo?.();
    if (options.holds) holding.push(letGo);
    else letGo();
    return result;
  };
  const avoided = new Map<string, string>();
  return {
    id: 'fake',
    requests,
    frameRequests,
    holding,
    pass: async (request, passOptions = {}) => {
      requests.push(request);
      passOptions.onSend?.(options.pid ?? FAKE_HELPER_PID);
      return settle(await script(request, passOptions.signal), passOptions.onLetGo);
    },
    frames: async (request, framesOptions = {}) => {
      frameRequests.push(request);
      framesOptions.onSend?.(options.pid ?? FAKE_HELPER_PID);
      return settle(
        await (options.frames ?? declinesFrames)(request, framesOptions.signal),
        framesOptions.onLetGo,
      );
    },
    avoid: (path, reason) => {
      avoided.set(path, reason);
    },
    avoided: (path) => avoided.get(path),
    close: async () => {},
  };
}

/** A pass that writes each set's frames (bytes of the right size) and reports `frames` analysis frames. */
export function writesSets(frames: number): PassScript {
  return async (request) => {
    const sets: number[] = [];
    for (const set of request.sets) {
      const count = Math.min(set.maxFrames, Math.ceil(frames / set.every));
      const each = set.width * set.height * (set.format === 'rgb24' ? 3 : 1);
      await writeFile(set.path, Buffer.alloc(count * each, 7));
      sets.push(count);
    }
    return ok({ frames, sets, ms: 5 });
  };
}

export function countingGate(): HardwareSessionGate & {
  readonly held: () => number;
  readonly taken: number[];
  /** What the leases did, in order: `adopt <pid>`, `release`. */
  readonly events: string[];
} {
  let held = 0;
  const taken: number[] = [];
  const events: string[] = [];
  return {
    taken,
    events,
    held: () => held,
    acquire: async (weight) => {
      held += weight;
      taken.push(weight);
      let released = false;
      return ok({
        weight,
        adopt: (pid: number) => void events.push(`adopt ${pid}`),
        release: async () => {
          if (!released) {
            held -= weight;
            events.push('release');
          }
          released = true;
        },
      });
    },
    limit: async () => 2,
    inUse: async () => held,
  };
}
