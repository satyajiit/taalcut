// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How much the picture a crop path shows really moves, measured on the source clip itself: every frame's crop
 * window (the planned keys, as the composition pans them) sampled from the decoded clip at QA's analysis size, then
 * FFmpeg's `freezedetect` rule run over those windows. No browser, no encoder, no clock: the same clip and keys give
 * the same answer on an idle or a busy Mac.
 *
 * freezedetect (libavfilter/vf_freezedetect.c) keeps a reference frame and compares every later frame with it
 * (mean absolute difference over the full sample range); a frame outside the noise becomes the new reference, and
 * a reference held for the minimum duration is a freeze. Which frame becomes a reference depends on every
 * difference before it, so on a picture that barely moves a tiny change anywhere upstream (an encoder's noise)
 * decides whether a freeze is reported. A framed clip with no freeze here even at a looser noise than QA's leaves
 * the render's own noise nothing to tip.
 */
import { runProcess, type MediaContext } from '@taalcut/media';
import { cropAt } from '../../src/reframe/crop-window';
import type { CropKey } from '../../src/reframe/framing-types';
import type { FrameSpan } from '../../src/plan/types';
import { QA_THRESHOLDS } from '../../src/qa/thresholds.v1';

/** The decoded clip in luma, one byte per pixel, frame after frame. */
export interface LumaClip {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly Uint8Array[];
}

/** Decodes `path` to luma at `width`×`height` (area scaling, as QA's pass shrinks). */
export async function decodeLuma(
  ctx: MediaContext,
  path: string,
  size: { readonly width: number; readonly height: number },
): Promise<LumaClip> {
  const scale = `scale=${size.width}:${size.height}:flags=area`;
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    ['-v', 'error', '-i', path, '-vf', scale, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { timeoutMs: 120_000, maxStdoutBytes: 256 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`decode failed: ${result.error.code}`);
  const bytes = new Uint8Array(result.value.stdout);
  const frameBytes = size.width * size.height;
  const frames: Uint8Array[] = [];
  for (let start = 0; start + frameBytes <= bytes.length; start += frameBytes)
    frames.push(bytes.subarray(start, start + frameBytes));
  return { width: size.width, height: size.height, frames };
}

/** Bilinear luma at a fractional pixel of one frame (edges clamped). */
function lumaAt(clip: LumaClip, frame: Uint8Array, x: number, y: number): number {
  const fx = Math.min(clip.width - 1, Math.max(0, x));
  const fy = Math.min(clip.height - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(clip.width - 1, x0 + 1);
  const y1 = Math.min(clip.height - 1, y0 + 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const top = (frame[y0 * clip.width + x0] ?? 0) * (1 - ax) + (frame[y0 * clip.width + x1] ?? 0) * ax;
  const bottom = (frame[y1 * clip.width + x0] ?? 0) * (1 - ax) + (frame[y1 * clip.width + x1] ?? 0) * ax;
  return top * (1 - ay) + bottom * ay;
}

/**
 * What output frame `frame` shows: source frame `frame` (the clip starts at the timeline's start and plays 1:1)
 * through the crop window at that frame, sampled at QA's analysis size.
 */
export function framedPicture(clip: LumaClip, keys: readonly CropKey[], frame: number): Float32Array {
  const { width, height } = QA_THRESHOLDS.analysisSize;
  const source = clip.frames[frame];
  if (!source) throw new Error(`no source frame ${frame}`);
  const crop = cropAt(keys, frame);
  const picture = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const y = (crop.y + ((row + 0.5) / height) * crop.height) * clip.height - 0.5;
    for (let column = 0; column < width; column++) {
      const x = (crop.x + ((column + 0.5) / width) * crop.width) * clip.width - 0.5;
      picture[row * width + column] = lumaAt(clip, source, x, y);
    }
  }
  return picture;
}

/** freezedetect's difference: mean absolute difference as a share of the full 8-bit range. */
function meanDifference(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let at = 0; at < a.length; at++) sum += Math.abs((a[at] ?? 0) - (b[at] ?? 0));
  return sum / a.length / 256;
}

/**
 * The stretches freezedetect reports in `pictures` at `noiseDb` and `minFrames`, as half-open frame spans: a port of
 * its filter_frame (a reference reaching the minimum duration opens a freeze, the first frame outside the noise
 * closes it and becomes the next reference).
 */
export function freezeSpans(
  pictures: readonly Float32Array[],
  noiseDb: number,
  minFrames: number,
): FrameSpan[] {
  const noise = 10 ** (noiseDb / 20);
  const spans: FrameSpan[] = [];
  let reference = 0;
  let frozen = false;
  let start = 0;
  for (let frame = 1; frame < pictures.length; frame++) {
    const still = meanDifference(pictures[reference]!, pictures[frame]!) <= noise;
    if (frame - reference >= minFrames) {
      if (!frozen) start = reference;
      if (!still) spans.push({ start, end: frame });
      frozen = still;
    }
    if (!still) {
      reference = frame;
      frozen = false;
    }
  }
  if (frozen) spans.push({ start, end: pictures.length });
  return spans;
}
