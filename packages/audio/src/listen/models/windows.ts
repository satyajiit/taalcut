// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The windows each model reads, as earshot cuts them: `vocab.spans_for` (describe, match, rank: 10 s windows, hop
 * 5 s, the last flush with the end, at most 6 evenly spaced), `audio.windows(pad_last=True)` (a CLAP input longer
 * than 10 s), and `ast.probs` (10.24 s at 16 kHz, hop half that, the last flush with the end).
 */
import { LISTEN_CONFIG } from '../config';

const SR = LISTEN_CONFIG.sampleRate;

/** Python's round(): halves to even. */
export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export type Span = readonly [start: number, end: number];

/** `vocab.spans_for(start, end, max_win)`, seconds. */
export function clapSpans(
  start: number,
  end: number,
  maxWindows: number = LISTEN_CONFIG.windows.maxWindows,
): Span[] {
  const n = pyRound((end - start) * SR);
  const w = Math.trunc(LISTEN_CONFIG.windows.winS * SR);
  const h = Math.trunc(LISTEN_CONFIG.windows.hopS * SR);
  if (n <= w) return [[start, end]];
  let starts: number[] = [];
  for (let s = 0; s <= n - w; s += h) starts.push(s);
  if ((n - w) % h !== 0) starts.push(n - w);
  if (maxWindows > 0 && starts.length > maxWindows) {
    const last = starts.length - 1;
    starts = Array.from(
      { length: maxWindows },
      (_, i) => starts[pyRound((last * i) / (maxWindows - 1))] ?? 0,
    );
  }
  return starts.map((s) => [start + s / SR, start + (s + w) / SR] as const);
}

/** The samples of `span` in a source that starts at 0 s: `x[int(round(s·SR)):int(round(e·SR))]`. */
export function spanSamples(source: Float32Array, span: Span, sampleRate: number = SR): Float32Array {
  const a = Math.max(0, Math.min(source.length, pyRound(span[0] * sampleRate)));
  const b = Math.max(a, Math.min(source.length, pyRound(span[1] * sampleRate)));
  return source.subarray(a, b);
}

/** `audio.windows(x, win, hop, pad_last=True)`: the sample offsets of each window (one at 0 when it fits). */
export function windowStarts(length: number, win: number, hop: number): number[] {
  if (length <= win) return [0];
  const starts: number[] = [];
  for (let s = 0; s <= length - win; s += hop) starts.push(s);
  if ((length - win) % hop !== 0) starts.push(length - win);
  return starts;
}

/** A CLAP input as `Clap.embed_audio` splits it: whole when ≤ 10 s, else 10 s windows (hop 5 s, last flush). */
export function clapInputWindows(segment: Float32Array): Float32Array[] {
  const win = LISTEN_CONFIG.clap.maxSamples;
  if (segment.length <= win) return [segment];
  return windowStarts(segment.length, win, win / 2).map((s) => segment.subarray(s, s + win));
}

/** `AST.probs`'s windows over a 16 kHz signal: whole when ≤ 10.24 s, else hop 5.12 s with the last flush. */
export function astWindows(signal16k: Float32Array): Float32Array[] {
  const n = Math.trunc(LISTEN_CONFIG.ast.winS * LISTEN_CONFIG.ast.sampleRate);
  if (signal16k.length <= n) return [signal16k];
  const hop = Math.trunc(n / 2);
  return windowStarts(signal16k.length, n, hop).map((s) => signal16k.subarray(s, s + n));
}
