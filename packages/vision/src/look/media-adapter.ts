// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs-process side of measureLook and bakeGrade: PNG stills in, a grade
 * cube out. Decoding stays here so a test can hand back PNG bytes. The path
 * lookup and the cache write stay with the desktop, which owns both.
 */
import {
  CancelledError,
  err,
  ok,
  type AssetId,
  type AsyncResult,
  type DerivedFileRef,
  type TimeRange,
} from '@taalcut/core';
import { LookUnavailable } from './errors';
import type { GradeLutSink, LookFrameSource } from './grade-jobs';
import type { LookFrame } from './look-stats';
import { decodePngRgb } from './png-rgb';
import { frameCountFor, sampleSeconds } from './sample-times';

/** One PNG still of the asset at a time, in seconds. The caller chooses the decoder. */
export interface StillSource {
  png(path: string, atSeconds: number, signal: AbortSignal): AsyncResult<Uint8Array>;
}

export interface StillLookOptions {
  /** Present original for the asset. Undefined when the file is offline. */
  readonly pathOf: (assetId: AssetId) => Promise<string | undefined>;
  readonly still: StillSource;
  /** Overrides the one-per-second plan. Tests pass a small count. */
  readonly frames?: number;
}

function planned(range: TimeRange, frames: number | undefined): number {
  if (frames !== undefined && Number.isInteger(frames) && frames > 0) return frames;
  return frameCountFor(range);
}

/**
 * Samples PNG stills, decodes them to full-range bt709 RGB, and drops a frame
 * that fails. No still at all is vision.look_unavailable, whose detail names
 * the last failure's code. The pixels leave with the returned frames; this
 * holds nothing.
 */
export function createStillLookFrames(options: StillLookOptions): LookFrameSource {
  return {
    async sample(assetId, range, signal) {
      if (signal.aborted) return err(CancelledError());
      let path: string | undefined;
      try {
        path = await options.pathOf(assetId);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : 'no path';
        return err(LookUnavailable(undefined, { detail }));
      }
      if (!path) return err(LookUnavailable(undefined, { detail: 'no present original' }));
      const times = sampleSeconds(range, planned(range, options.frames));
      const frames: LookFrame[] = [];
      let lastFailure = 'no still planned';
      for (const at of times) {
        if (signal.aborted) return err(CancelledError());
        const png = await options.still.png(path, at, signal);
        if (!png.ok) {
          lastFailure = png.error.code;
          continue;
        }
        const decoded = decodePngRgb(png.value);
        if (!decoded.ok) {
          lastFailure = decoded.error.code;
          continue;
        }
        frames.push({
          width: decoded.value.width,
          height: decoded.value.height,
          rgb: decoded.value.rgb,
          encoding: 'bt709',
          range: 'full',
        });
      }
      if (frames.length === 0) {
        return err(LookUnavailable(undefined, { detail: `no decodable frame (last: ${lastFailure})` }));
      }
      return ok(frames);
    },
  };
}

/** Writes the cube text through the media cache and returns the derived-file ref. */
export function gradeLutFromCache(
  put: (key: string, body: string) => AsyncResult<{ readonly bytes: number }>,
): GradeLutSink {
  return {
    async write(_assetId, cubeText, key) {
      const written = await put(key, cubeText);
      if (!written.ok) return written;
      const ref: DerivedFileRef = {
        kind: 'gradeLut',
        key,
        bytes: written.value.bytes,
        mimeType: 'text/plain',
        recipe: 1,
      };
      return ok(ref);
    },
  };
}
