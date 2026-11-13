// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which of the 4 beat phases starts the bar (earshot timeline `_downbeat_phase`, 4/4 assumed): harmony changes (the
 * pitch-class profile between beats, from 4096-point magnitudes on the graph) plus low-band onsets (a kick) are
 * strongest on downbeats.
 */
import type { SpectrogramRunner } from './spectrogram-graph';
import { downbeatSpec } from './spectra';
import { std } from './stats';
import { centredFrames } from './transforms';

/** `beats` are 10 ms frame indices; returns the phase 0–3. */
export async function downbeatPhase(
  mono: ArrayLike<number>,
  beats: readonly number[],
  runner: SpectrogramRunner,
): Promise<number> {
  const out = await runner.spectrogram(downbeatSpec(), centredFrames(mono, 4096, 480, 'constant'));
  const n = out.frames;
  const chroma = (i: number, c: number) => out.data[i * 13 + c] ?? 0;
  const low = new Float64Array(n);
  for (let i = 0; i < n; i++) low[i] = Math.log1p(out.data[i * 13 + 12] ?? 0);
  const b = beats.map((v) => Math.min(v, n - 1));
  const seg: number[][] = [];
  for (let k = 0; k < b.length; k++) {
    const p = b[k] ?? 0;
    const q = k + 1 < b.length ? (b[k + 1] ?? 0) : p;
    const row = new Array<number>(12).fill(0);
    if (k + 1 < b.length && q > p) {
      for (let i = p; i < q; i++) for (let c = 0; c < 12; c++) row[c] = (row[c] ?? 0) + chroma(i, c);
      for (let c = 0; c < 12; c++) row[c] = (row[c] ?? 0) / (q - p);
    } else {
      for (let c = 0; c < 12; c++) row[c] = chroma(p, c);
    }
    const norm = Math.sqrt(row.reduce((s, v) => s + v * v, 0)) + 1e-9;
    seg.push(row.map((v) => v / norm));
  }
  const harm = seg.map((row, k) => {
    if (k === 0) return 0;
    const prev = seg[k - 1] as number[];
    return 1 - row.reduce((s, v, c) => s + v * (prev[c] ?? 0), 0);
  });
  const rise = new Float64Array(n);
  for (let i = 1; i < n; i++) rise[i] = Math.max((low[i] ?? 0) - (low[i - 1] ?? 0), 0);
  const kick = b.map((i) => {
    let m = -Infinity;
    for (let j = Math.max(0, i - 3); j < Math.min(n, i + 4); j++) m = Math.max(m, rise[j] ?? 0);
    return m;
  });
  const hs = std(harm) + 1e-9;
  const ks = std(kick) + 1e-9;
  const acc = harm.map((h, k) => h / hs + (kick[k] ?? 0) / ks);
  let best = 0;
  let bestMean = -Infinity;
  for (let p = 0; p < 4; p++) {
    const picks = acc.filter((_, i) => i >= p && (i - p) % 4 === 0);
    const m = picks.length > 0 ? picks.reduce((s, v) => s + v, 0) / picks.length : Number.NaN;
    if (m > bestMean) {
      bestMean = m;
      best = p;
    }
  }
  return best;
}
