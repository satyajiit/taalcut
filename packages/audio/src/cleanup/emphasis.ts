// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Emphasis points for punch-ins (SPEC P3.7), pure: for each word that isn't a filler, the peak RMS of 32 ms frames
 * inside its voiced interior, against the clip's median word peak. A word over the ratio is a mark; marks keep
 * 4 s apart (the strongest wins) and none falls in the first 0.5 s. Emphasis never causes a cut; the timeline's
 * planner turns the strongest into punch-ins. No pitch tracking in v1.
 */
import { CLEANUP_AUDIO_CONFIG } from './config';
import { overlapMs, type Span } from './segments';
import type { TimedWord } from './words';

export interface EmphasisHit {
  readonly wordIndex: number;
  readonly range: Span;
  readonly strength: number;
}

function peakRms(samples: Float32Array, sampleRate: number, span: Span): number {
  const frame = Math.round((CLEANUP_AUDIO_CONFIG.emphasis.frameMs * sampleRate) / 1000);
  const from = Math.max(0, Math.floor((span.startMs * sampleRate) / 1000));
  const to = Math.min(samples.length, Math.ceil((span.endMs * sampleRate) / 1000));
  let peak = 0;
  for (let start = from; start < to; start += frame) {
    let sum = 0;
    const end = Math.min(to, start + frame);
    for (let i = start; i < end; i++) sum += (samples[i] ?? 0) ** 2;
    if (end > start) peak = Math.max(peak, Math.sqrt(sum / (end - start)));
  }
  return peak;
}

export function findEmphasis(input: {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly words: readonly TimedWord[];
  readonly islands: readonly Span[];
  /** Word indexes that are fillers: never emphasis. */
  readonly fillerWords: ReadonlySet<number>;
}): EmphasisHit[] {
  const { ratio, minGapMs, skipStartMs } = CLEANUP_AUDIO_CONFIG.emphasis;
  const peaks = input.words.map((word, index) => {
    if (input.fillerWords.has(index)) return null;
    const voiced = input.islands.filter((island) => overlapMs(island, word) > 0);
    if (voiced.length === 0) return null;
    const interior = {
      startMs: Math.max(word.startMs, voiced[0]?.startMs ?? word.startMs),
      endMs: Math.min(word.endMs, voiced.at(-1)?.endMs ?? word.endMs),
    };
    return {
      index,
      range: { startMs: word.startMs, endMs: word.endMs },
      peak: peakRms(input.samples, input.sampleRate, interior),
    };
  });
  const present = peaks.filter((p): p is NonNullable<typeof p> => p !== null && p.peak > 0);
  if (present.length < 3) return [];
  const sorted = present.map((p) => p.peak).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return [];
  const candidates = present
    .filter((p) => p.range.startMs >= skipStartMs && p.peak / median > ratio)
    .map((p) => ({
      wordIndex: p.index,
      range: p.range,
      strength: Math.min(1, Math.round(((p.peak / median - ratio) / ratio) * 1000) / 1000),
    }))
    .sort((a, b) => b.strength - a.strength);
  const kept: EmphasisHit[] = [];
  for (const c of candidates)
    if (kept.every((k) => Math.abs(k.range.startMs - c.range.startMs) >= minGapMs)) kept.push(c);
  return kept.sort((a, b) => a.range.startMs - b.range.startMs);
}
