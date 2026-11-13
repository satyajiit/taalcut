// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The calibrated score (earshot `Vocab.calibrate`, method 'both'): for a sound `a` and a description `q`,
 *   u = cos(a, q) − m·q            the description's bias over the reference recordings removed;
 *   z = (u − mean_t u_t) / (std_t u_t + 1e-9)   over the 322 vocabulary terms t for this same sound (population std).
 * `percentile` is the share of terms the query beats; `rankInVocab` where it would rank among them.
 */
import { LISTEN_CONFIG } from '../config';
import { dot, type ListenVocab } from './vocab';

export interface SoundCalibration {
  /** Per vocabulary term, in the vocabulary's order. */
  readonly cos: Float64Array;
  readonly u: Float64Array;
  readonly z: Float64Array;
  readonly mean: number;
  /** The population std of u, plus 1e-9. */
  readonly std: number;
}

export interface QueryCalibration {
  readonly cosine: number;
  readonly u: number;
  readonly z: number;
  /** 0–100: the share of vocabulary terms whose u is below the query's. */
  readonly percentile: number;
  /** 1 + the terms whose u is above the query's. */
  readonly rankInVocab: number;
  readonly vocabSize: number;
}

export function calibrate(audio: Float32Array, vocab: ListenVocab): SoundCalibration {
  const n = vocab.rows.length;
  const cos = new Float64Array(n);
  const u = new Float64Array(n);
  let sum = 0;
  for (let t = 0; t < n; t++) {
    cos[t] = dot(audio, vocab.rows[t] ?? []);
    u[t] = (cos[t] ?? 0) - (vocab.bias[t] ?? 0);
    sum += u[t] ?? 0;
  }
  const mean = sum / n;
  let sq = 0;
  for (let t = 0; t < n; t++) sq += ((u[t] ?? 0) - mean) ** 2;
  const std = Math.sqrt(sq / n) + LISTEN_CONFIG.calibration.stdEpsilon;
  const z = Float64Array.from(u, (value) => (value - mean) / std);
  return { cos, u, z, mean, std };
}

/** One description against a calibrated sound; `bias` is q·m (`vocab.biasOf`). */
export function calibrateQuery(
  sound: SoundCalibration,
  audio: Float32Array,
  query: Float32Array,
  bias: number,
): QueryCalibration {
  const cosine = dot(audio, query);
  const u = cosine - bias;
  let below = 0;
  let above = 0;
  for (const term of sound.u) {
    if (term < u) below += 1;
    if (term > u) above += 1;
  }
  return {
    cosine,
    u,
    z: (u - sound.mean) / sound.std,
    percentile: (100 * below) / sound.u.length,
    rankInVocab: above + 1,
    vocabSize: sound.u.length,
  };
}
