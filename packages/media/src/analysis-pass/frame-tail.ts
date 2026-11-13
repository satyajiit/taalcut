// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frames a running FFmpeg writes to a raw file, handed to the caller while it writes them (IX2-C3). FFmpeg
 * writes at the decode's pace; the file is read at the caller's: each batch waits until the caller's
 * `onFrames` for the one before has settled. So the decode never waits for the caller (a model, say), the
 * caller holds one batch at a time, and what it hasn't read yet waits on disk. stdout already carries the
 * analysis frames, and a second pipe would need every process runner to pass another descriptor; a file
 * works with all of them.
 */
import { open, type FileHandle } from 'node:fs/promises';
import { err, ok, type Result } from '@taalcut/core';
import { DecodeFailed, fileParams } from '../errors';

export interface FrameBatch {
  /** Frames of this stream before the first in `data`. */
  readonly first: number;
  readonly count: number;
  /** `count` frames, back to back. */
  readonly data: Buffer;
}

export interface FrameTailOptions {
  readonly bytesPerFrame: number;
  /** Frames handed over at most at once. */
  readonly batchFrames: number;
  /** How often a file that has no new frame yet is looked at again. */
  readonly pollMs: number;
  readonly onFrames: (batch: FrameBatch) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface FrameTail {
  /** The writer has finished: read what is left, hand it over, and resolve with the frame count. */
  finish(): Promise<Result<number>>;
  /** Stops reading (the writer failed or was cancelled); resolves once the reader has stopped. */
  stop(): Promise<void>;
}

const pause = (ms: number, wake: Promise<void>) =>
  Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), wake]);

async function openIfThere(path: string): Promise<FileHandle | undefined> {
  try {
    return await open(path, 'r');
  } catch {
    // FFmpeg creates the file once its first frame is out; until then there is nothing to read.
    return undefined;
  }
}

export function tailFrames(path: string, options: FrameTailOptions): FrameTail {
  const { bytesPerFrame, batchFrames, pollMs, onFrames, signal } = options;
  let finished = false;
  let stopped = false;
  let wake: () => void = () => {};
  const woken = new Promise<void>((resolve) => (wake = resolve));
  let delivered = 0;

  const loop = async (): Promise<void> => {
    let file: FileHandle | undefined;
    let offset = 0;
    try {
      for (;;) {
        if (stopped || signal?.aborted) return;
        // Read `finished` before the size: a size read after it is the final one.
        const last = finished;
        file ??= await openIfThere(path);
        const size = file ? (await file.stat()).size : 0;
        const whole = Math.floor((size - offset) / bytesPerFrame);
        if (file && whole > 0) {
          const count = Math.min(whole, batchFrames);
          const data = Buffer.alloc(count * bytesPerFrame);
          await file.read(data, 0, data.length, offset);
          offset += data.length;
          await onFrames({ first: delivered, count, data });
          delivered += count;
          continue;
        }
        if (last) return;
        await pause(pollMs, woken);
      }
    } finally {
      await file?.close();
    }
  };
  // A read that fails (the file went away) ends the stream with an error; the pass's other outputs stand.
  const running: Promise<Result<number>> = loop().then(
    () => ok(delivered),
    (cause: unknown) =>
      err(
        DecodeFailed(fileParams(path), {
          detail: `frame stream: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
      ),
  );
  return {
    async finish() {
      finished = true;
      wake();
      return running;
    },
    async stop() {
      stopped = true;
      wake();
      await running;
    },
  };
}
