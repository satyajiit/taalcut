// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The video pass over each clip's own conformed segment, which tells a dark stretch the footage has from one the
 * render made (checks/video.ts; a freeze is asked of the segment over the freeze's own frames, source-stillness.ts).
 * Each segment is decoded at most once per QA run. A retryable failure (FFmpeg refused a process under load, a
 * timeout) runs once more: without the segment's pass a check can't credit the footage and blames the render, so a
 * busy machine alone must not turn the footage's own darkness or stillness into a failure.
 */
import type { MediaContext } from '@taalcut/media';
import type { SegmentPass, SegmentPasses } from '../checks/video';
import { runVideoPass, type VideoPassOptions } from '../measure/video-pass';

type Segments = ReadonlyMap<string, { readonly path: string; readonly startFrame: number }>;

/** The video pass, once more after a retryable failure. */
export async function passWithRetry(media: MediaContext, path: string, options: VideoPassOptions) {
  const first = await runVideoPass(media, path, options);
  if (first.ok || !first.error.retryable || options.signal?.aborted) return first;
  return runVideoPass(media, path, options);
}

export function segmentPasses(
  media: MediaContext,
  segments: Segments | undefined,
  options: VideoPassOptions,
): SegmentPasses {
  const cache = new Map<string, Promise<SegmentPass | undefined>>();
  return (clipId) => {
    const segment = segments?.get(clipId);
    if (!segment) return Promise.resolve(undefined);
    let found = cache.get(clipId);
    if (!found) {
      found = passWithRetry(media, segment.path, options).then((result) =>
        result.ok ? { pass: result.value, startFrame: segment.startFrame } : undefined,
      );
      cache.set(clipId, found);
    }
    return found;
  };
}
