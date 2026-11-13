// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `split_predict_aggregate` for a fixed 1500-frame ONNX window.
 * Starts follow upstream `np.arange(-border, nFrames - border, step)`.
 * `avoid_short_end` then moves the last start to `nFrames - (chunk - border)`
 * so the tail is not a short zero-padded chunk. A clip that fits in one window
 * starts at 0; border trim must not eat the beginning of that clip.
 */
import { AUDIO_CONFIG } from '../config';

const CHUNK = AUDIO_CONFIG.beats.windowFrames;
const BORDER = AUDIO_CONFIG.beats.borderFrames;
const STEP = CHUNK - 2 * BORDER;

export interface BeatWindow {
  readonly start: number;
}

export interface WindowPrediction {
  readonly start: number;
  readonly beat: Float32Array;
  readonly downbeat: Float32Array;
}

export function planWindows(nFrames: number): BeatWindow[] {
  if (nFrames <= 0) return [];
  if (nFrames <= CHUNK) return [{ start: 0 }];
  const starts: number[] = [];
  for (let start = -BORDER; start < nFrames - BORDER; start += STEP) starts.push(start);
  if (starts.length === 0) return [{ start: 0 }];
  if (nFrames > STEP) {
    const forced = nFrames - (CHUNK - BORDER);
    const previous = starts.length >= 2 ? (starts[starts.length - 2] ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
    // Further right than the previous window, and not a second copy of it.
    if (forced > previous) starts[starts.length - 1] = forced;
  }
  const windows: BeatWindow[] = [];
  for (const start of starts) {
    if (windows.length === 0 || windows[windows.length - 1]?.start !== start) windows.push({ start });
  }
  return windows;
}

/** `keep_first`: later windows are written first so earlier ones win overlaps. */
export function stitchPredictions(
  nFrames: number,
  pieces: readonly WindowPrediction[],
): { beat: Float32Array; downbeat: Float32Array } {
  const beat = new Float32Array(Math.max(0, nFrames));
  const downbeat = new Float32Array(Math.max(0, nFrames));
  beat.fill(-1000);
  downbeat.fill(-1000);
  const ordered = pieces.slice().sort((a, b) => b.start - a.start);
  for (const piece of ordered) {
    copyWindow(beat, piece.beat, piece.start, nFrames);
    copyWindow(downbeat, piece.downbeat, piece.start, nFrames);
  }
  return { beat, downbeat };
}

function copyWindow(dst: Float32Array, src: Float32Array, start: number, nFrames: number): void {
  let srcBegin: number;
  let dstBegin: number;
  let dstEnd: number;
  if (nFrames <= CHUNK && start >= 0) {
    // The whole clip is real audio. Right-hand zeros are padding, not a border to drop.
    srcBegin = 0;
    dstBegin = start;
    dstEnd = Math.min(nFrames, start + src.length);
  } else {
    srcBegin = BORDER;
    dstBegin = start + BORDER;
    dstEnd = start + CHUNK - BORDER;
    if (dstBegin < 0) {
      srcBegin -= dstBegin;
      dstBegin = 0;
    }
    if (dstEnd > nFrames) dstEnd = nFrames;
    // The last window keeps real frames that sit in its right border.
    const coveredEnd = Math.min(nFrames, start + src.length);
    if (coveredEnd > dstEnd && start + CHUNK >= nFrames) dstEnd = coveredEnd;
  }
  const count = dstEnd - dstBegin;
  for (let i = 0; i < count; i++) {
    const srcIndex = srcBegin + i;
    const dstIndex = dstBegin + i;
    if (srcIndex < 0 || srcIndex >= src.length || dstIndex < 0 || dstIndex >= dst.length) continue;
    dst[dstIndex] = src[srcIndex] ?? 0;
  }
}
