// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The describer's input: each shot's best frame as a 768 px JPEG. With the
 * asset's frame source (the job's, IX-D1) a frame is read on the plan's grid
 * with no probe, and once the model has answered for the first shot the rest
 * are decoded together (one run per seek window) rather than one run each;
 * a run that stops at its first skip decodes one frame. Without a source,
 * media's extractFrame reads each frame.
 */
import { err, ok, ValidationError, type AsyncResult, type FrameRate } from '@taalcut/core';
import { extractFrame, type MediaContext } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import type { FrameRequest, FrameSource } from '../media/frame-source';

export interface FrameImage {
  readonly data: string;
  readonly mimeType: 'image/jpeg' | 'image/png';
}

export interface ShotFrames {
  read(frame: number): AsyncResult<FrameImage>;
  /** Frames the next reads will ask for. */
  ahead(frames: readonly number[]): Promise<void>;
}

const jpeg = (frames: readonly number[]): FrameRequest => ({
  size: { longSide: VISION_CONFIG.describe.longSide },
  format: 'jpeg',
  frames,
});

export function shotFrames(
  input: { readonly path: string; readonly rate: FrameRate },
  deps: { readonly media: MediaContext; readonly frames?: FrameSource },
  signal: AbortSignal | undefined,
): ShotFrames {
  const source = deps.frames;
  if (source) {
    return {
      async read(frame) {
        const read = await source.frames(jpeg([frame]), signal);
        if (!read.ok) return read;
        const image = read.value[0];
        if (!image) return err(ValidationError({ field: 'frame' }, { detail: `no frame ${frame}` }));
        return ok({ data: Buffer.from(image.data).toString('base64'), mimeType: 'image/jpeg' });
      },
      async ahead(frames) {
        // A failed read-ahead costs nothing: each frame is read again on its own.
        if (frames.length > 0) await source.prefetch([jpeg(frames)], signal);
      },
    };
  }
  return {
    async read(frame) {
      const extracted = await extractFrame(
        input.path,
        { value: frame * input.rate.den, rate: input.rate.num },
        deps.media,
        {
          format: 'jpeg',
          maxDimension: VISION_CONFIG.describe.longSide,
          jpegQuality: 4,
          ...(signal ? { signal } : {}),
        },
      );
      if (!extracted.ok) return extracted;
      return ok({ data: extracted.value.data.toString('base64'), mimeType: extracted.value.mimeType });
    },
    ahead: async () => undefined,
  };
}
