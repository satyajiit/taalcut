// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text with timing and position (P2-T4): OCR at 4 samples a second
 * plus the first frame of each cut (a caption often changes on a cut), at
 * 1280 px on the long side, through the routed OCR engine, then tracked to
 * frame-exact edges. Frames are read in chunks so memory stays flat on a
 * long reel; frames that barely changed reuse the last OCR result.
 */
import { CancelledError, err, ok, type AsyncResult, type OnScreenText } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import { fitLongSide, probeSource, sampleFrames, type SampledFrame, type VideoSource } from '../media/frames';
import { recognizeWithReuse } from '../ocr/reuse';
import { trackOnScreenText } from '../ocr/track';
import type { OcrFrames } from '../ocr/track-refine';
import type { OcrEngine, OcrFrame, OcrPage, OcrRecognizeOptions } from '../ocr/types';

export interface OverlayDeps {
  readonly media: MediaContext;
  readonly ocr: OcrEngine;
}

export interface ReadOverlaysOptions {
  /** OCR samples a second. Default `breakdown.ocrFps` (4). */
  readonly fps?: number;
  /** Languages to read, in priority order (BCP 47). */
  readonly languages: readonly string[];
  /** First frames of cuts: sampled too. */
  readonly cutFrames?: readonly number[];
  /** Grid frames [start, end). */
  readonly range?: { readonly start: number; readonly end: number };
  /** Long side of the frames OCR reads. Default `breakdown.ocrLongSide`. */
  readonly longSide?: number;
  readonly signal?: AbortSignal;
  progress?(fraction: number): void;
}

/** Frames per sampling pass: bounded memory (16 frames of 1280×720 RGB is about 44 MB). */
const CHUNK = 16;

export async function readOverlays(
  path: string,
  deps: OverlayDeps,
  options: ReadOverlaysOptions,
): AsyncResult<{ readonly overlays: OnScreenText[]; readonly source: VideoSource }> {
  const { signal } = options;
  const probed = await probeSource(deps.media, path, signal);
  if (!probed.ok) return probed;
  const source = probed.value;
  const frameCount = source.frameCount ?? 1;
  const start = Math.max(0, options.range?.start ?? 0);
  const end = Math.min(frameCount, options.range?.end ?? frameCount);
  const fps = source.rate.num / source.rate.den;
  const every = Math.max(1, Math.round(fps / (options.fps ?? VISION_CONFIG.breakdown.ocrFps)));
  const wanted = new Set<number>();
  for (let f = start; f < end; f += every) wanted.add(f);
  for (const cut of options.cutFrames ?? []) if (cut >= start && cut < end) wanted.add(cut);
  const frames = [...wanted].sort((a, b) => a - b);
  const size = fitLongSide(
    source.width,
    source.height,
    options.longSide ?? VISION_CONFIG.breakdown.ocrLongSide,
  );
  const read = { languages: options.languages, ...(signal ? { signal } : {}) };

  const pages: OcrPage[] = [];
  for (let i = 0; i < frames.length; i += CHUNK) {
    if (signal?.aborted) return err(CancelledError());
    const chunk = await sampleFrames(deps.media, source, {
      size,
      format: 'rgb24',
      frames: frames.slice(i, i + CHUNK),
      ...(signal ? { signal } : {}),
    });
    if (!chunk.ok) return chunk;
    const recognised = await recognizeWithReuse(deps.ocr, chunk.value.map(ocrFrame), read);
    if (!recognised.ok) return recognised;
    pages.push(...recognised.value);
    options.progress?.(Math.min(0.9, (0.9 * (i + CHUNK)) / Math.max(1, frames.length)));
  }

  const tracked = await trackOnScreenText(
    {
      rate: source.rate,
      pages,
      endFrame: end,
      ocrFrames: refineReader(deps, source, size, read),
    },
    signal ? { signal } : {},
  );
  if (!tracked.ok) return tracked;
  options.progress?.(1);
  return ok({ overlays: tracked.value, source });
}

/** Each refinement round's frames: one decode and one engine call per chunk, not one per edge. */
function refineReader(
  deps: OverlayDeps,
  source: VideoSource,
  size: { readonly width: number; readonly height: number },
  read: Omit<OcrRecognizeOptions, 'meter'>,
): OcrFrames {
  return async (wanted, signal) => {
    const pages: OcrPage[] = [];
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const sampled = await sampleFrames(deps.media, source, {
        size,
        format: 'rgb24',
        frames: wanted.slice(i, i + CHUNK),
        ...(signal ? { signal } : {}),
      });
      if (!sampled.ok) return sampled;
      const page = await deps.ocr.recognize(sampled.value.map(ocrFrame), read);
      if (!page.ok) return page;
      pages.push(...page.value);
    }
    return ok(pages);
  };
}

export function ocrFrame(frame: SampledFrame): OcrFrame {
  return { index: frame.index, width: frame.width, height: frame.height, rgb: frame.data };
}
