// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One region of the picture read on its own (LYR1): the whole-frame pass samples four times a second, reuses the
 * page of a frame that barely changed and reads a word together with the print behind it. Here the region is cut
 * out of every frame asked, enlarged and read by itself, every frame by the engine (no reuse), so a word shown for
 * a quarter of a second over a busy picture is read. Each page also says how much the picture inside `watch`
 * changed since the frame asked before it: where words replace each other in place that jumps, read or not.
 * Boxes and quads come back in the whole picture's space.
 */
import { CancelledError, err, ok, type AsyncResult, type NormalisedBox } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { fitLongSide, probeSource, sampleFrames, type SampledFrame } from '../media/frames';
import { cropRgb, resizeRgb } from '../ocr/paddle/preprocess';
import { servedLanguages } from '../ocr/shot-text';
import type { OcrEngine, OcrFrame, OcrObservation, OcrPage, OcrQuad } from '../ocr/types';

export interface RegionPage extends OcrPage {
  /** Mean absolute difference of the watched picture's grey levels from the frame asked before, 0–1; 0 for the first. */
  readonly change: number;
}

export interface OcrRegionOptions {
  /** Grid frames to read, each one by the engine. */
  readonly frames: readonly number[];
  /** The part of the picture to read, as shares of it. */
  readonly region: NormalisedBox;
  /** Where the change is measured; default the region. */
  readonly watch?: NormalisedBox;
  /** How many times the region is enlarged before it is read (1–4); default 2. */
  readonly scale?: number;
  readonly languages: readonly string[];
  readonly signal?: AbortSignal;
}

/** Frames per decode and engine call. */
const CHUNK = 16;

interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A box of shares as whole pixels inside the frame, at least 2 by 2. */
export function pixelRect(box: NormalisedBox, width: number, height: number): PixelRect {
  const left = Math.min(width - 2, Math.max(0, Math.floor(box.x * width)));
  const top = Math.min(height - 2, Math.max(0, Math.floor(box.y * height)));
  const right = Math.min(width, Math.max(left + 2, Math.ceil((box.x + box.width) * width)));
  const bottom = Math.min(height, Math.max(top + 2, Math.ceil((box.y + box.height) * height)));
  return { left, top, width: right - left, height: bottom - top };
}

/** The region of a frame, enlarged `scale` times, as a frame for the engine. */
export function regionFrame(frame: SampledFrame, rect: PixelRect, scale: number): OcrFrame {
  const source = { data: frame.data, width: frame.width, height: frame.height };
  const cut = cropRgb(source, rect.left, rect.top, rect.left + rect.width, rect.top + rect.height);
  const crop = cut ?? source;
  const enlarged = resizeRgb(crop, Math.round(crop.width * scale), Math.round(crop.height * scale));
  return { index: frame.index, width: enlarged.width, height: enlarged.height, rgb: enlarged.data };
}

/** The grey levels (0–255) of a rectangle of an rgb24 frame, row-major. */
export function greyOf(frame: SampledFrame, rect: PixelRect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const at = ((rect.top + y) * frame.width + rect.left + x) * 3;
      out[y * rect.width + x] =
        0.299 * (frame.data[at] ?? 0) + 0.587 * (frame.data[at + 1] ?? 0) + 0.114 * (frame.data[at + 2] ?? 0);
    }
  }
  return out;
}

/** Mean absolute difference of two grey pictures of one size, 0–1. */
export function greyChange(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length / 255;
}

/** An observation read in the region, in the whole picture's space. */
export function inPicture(
  observation: OcrObservation,
  rect: PixelRect,
  width: number,
  height: number,
): OcrObservation {
  const x = (share: number) => (rect.left + share * rect.width) / width;
  const y = (share: number) => (rect.top + share * rect.height) / height;
  const { box, quad } = observation;
  return {
    ...observation,
    box: {
      x: x(box.x),
      y: y(box.y),
      width: (box.width * rect.width) / width,
      height: (box.height * rect.height) / height,
    },
    ...(quad ? { quad: quad.map((point) => ({ x: x(point.x), y: y(point.y) })) as unknown as OcrQuad } : {}),
  };
}

/** One page per frame asked that the file has, in frame order. None when the engine reads none of the languages. */
export async function ocrRegion(
  path: string,
  deps: { readonly media: MediaContext; readonly ocr: OcrEngine },
  options: OcrRegionOptions,
): AsyncResult<RegionPage[]> {
  const { signal } = options;
  const served = await servedLanguages(deps.ocr, options.languages);
  if (!served.ok) return served;
  if (served.value.length === 0) return ok([]);
  const probed = await probeSource(deps.media, path, signal);
  if (!probed.ok) return probed;
  const source = probed.value;
  const count = source.frameCount ?? 1;
  const frames = [...new Set(options.frames.filter((f) => Number.isInteger(f) && f >= 0 && f < count))].sort(
    (a, b) => a - b,
  );
  // The file's own size: the region is enlarged from the pixels it has.
  const size = fitLongSide(source.width, source.height, Math.max(source.width, source.height));
  const region = pixelRect(options.region, size.width, size.height);
  const watch = pixelRect(options.watch ?? options.region, size.width, size.height);
  const scale = Math.min(4, Math.max(1, options.scale ?? 2));
  const pages: RegionPage[] = [];
  let before: Uint8Array | undefined;
  for (let i = 0; i < frames.length; i += CHUNK) {
    if (signal?.aborted) return err(CancelledError());
    const sampled = await sampleFrames(deps.media, source, {
      size,
      format: 'rgb24',
      frames: frames.slice(i, i + CHUNK),
      ...(signal ? { signal } : {}),
    });
    if (!sampled.ok) return sampled;
    const ordered = [...sampled.value].sort((a, b) => a.index - b.index);
    const read = await deps.ocr.recognize(
      ordered.map((frame) => regionFrame(frame, region, scale)),
      { languages: served.value, ...(signal ? { signal } : {}) },
    );
    if (!read.ok) return read;
    ordered.forEach((frame, k) => {
      const grey = greyOf(frame, watch);
      pages.push({
        frame: frame.index,
        observations: (read.value[k]?.observations ?? []).map((observation) =>
          inPicture(observation, region, size.width, size.height),
        ),
        change: before ? greyChange(before, grey) : 0,
      });
      before = grey;
    });
  }
  return ok(pages);
}
