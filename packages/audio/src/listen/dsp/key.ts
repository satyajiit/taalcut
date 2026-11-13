// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The musical key (earshot features.key_estimate): the clip's mean constant-Q chroma correlated (Pearson) with the
 * Krumhansl–Kessler major and minor profiles rotated to each of the 12 tonics; the best three, best first.
 */
import { cqtChroma } from './cqt';
import type { SpectrogramRunner } from './spectrogram-graph';

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** earshot features.NOTE. */
export const KEY_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type KeyNote = (typeof KEY_NOTES)[number];
export type KeyMode = 'major' | 'minor';

export interface KeyCandidate {
  readonly tonic: KeyNote;
  readonly mode: KeyMode;
  /** Pearson r of the chroma with the rotated profile, rounded to 3 decimals. */
  readonly r: number;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] ?? 0;
    mb += b[i] ?? 0;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - ma;
    const dbv = (b[i] ?? 0) - mb;
    sab += da * dbv;
    saa += da * da;
    sbb += dbv * dbv;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : Number.NaN;
}

/** The ranking from a mean chroma (C first): every key, best first (NaN correlations last). */
export function rankKeys(chroma: readonly number[]): KeyCandidate[] {
  const out: Array<{ r: number; tonic: KeyNote; mode: KeyMode; name: string }> = [];
  for (const [mode, profile] of [
    ['major', KK_MAJOR],
    ['minor', KK_MINOR],
  ] as const) {
    for (let k = 0; k < 12; k++) {
      const rolled = profile.map((_, i) => profile[(i - k + 12) % 12] ?? 0);
      const tonic = KEY_NOTES[k] as KeyNote;
      out.push({ r: pearson(chroma, rolled), tonic, mode, name: `${tonic} ${mode}` });
    }
  }
  // Python's sort of (r, name) tuples, reversed: larger r first, then the larger name.
  out.sort((a, b) => {
    const ra = Number.isNaN(a.r) ? -Infinity : a.r;
    const rb = Number.isNaN(b.r) ? -Infinity : b.r;
    if (rb !== ra) return rb - ra;
    return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
  });
  return out.map(({ r, tonic, mode }) => ({ tonic, mode, r: Math.round(r * 1000) / 1000 }));
}

/** features.key_estimate on a 48 kHz mono signal: the best three keys; empty when the chroma is flat. */
export async function estimateKey(
  mono: ArrayLike<number>,
  runner: SpectrogramRunner,
): Promise<KeyCandidate[]> {
  const { chroma, frames } = await cqtChroma(mono, runner);
  if (frames === 0) return [];
  const meanChroma = new Array<number>(12).fill(0);
  for (let t = 0; t < frames; t++)
    for (let c = 0; c < 12; c++) meanChroma[c] = (meanChroma[c] ?? 0) + (chroma[t * 12 + c] ?? 0);
  for (let c = 0; c < 12; c++) meanChroma[c] = (meanChroma[c] ?? 0) / frames;
  const ranked = rankKeys(meanChroma);
  return Number.isNaN(ranked[0]?.r ?? Number.NaN) ? [] : ranked.slice(0, 3);
}
