// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot's realness model (earshot realness.py): two standardised logistic heads, one over the CLAP embedding and
 * one over 13 signal measurements, fused by a logistic layer. The fitted fusion gives the signal head weight 0, so
 * the CLAP head decides; both are computed, as upstream does. The 12 reference prompts are evidence only (the
 * closest one), never part of p_real.
 *
 * `realness-head.json` is the part of the vendored data/realness_model.json (@taalcut-vendor/earshot-data) this
 * reads, values unchanged (realness-model.test checks them against it): the vendored file's `eval` key can't be a
 * JSON module's named export under esbuild (tsx), and the packaged app inlines JSON imports rather than shipping
 * the vendor package, so a runtime read of the vendored file isn't an option either.
 */
import modelFile from './realness-head.json' with { type: 'json' };

export interface RealnessHead {
  readonly mean: readonly number[];
  readonly scale: readonly number[];
  /** [lower, upper] per input. */
  readonly clip?: readonly [readonly number[], readonly number[]];
  readonly coef: readonly number[];
  readonly intercept: number;
  readonly inputs: string | readonly string[];
}

export interface RealnessThresholds {
  readonly lo: number;
  readonly hi: number;
}

export interface RealnessFact {
  readonly feature: string;
  readonly side: 'real' | 'synth';
  readonly op: '<=' | '>=';
  readonly value: number;
  readonly precision: number;
}

export interface RealnessModel {
  readonly version: number;
  readonly trained: string;
  /** realness.LONG_S and WIN_S: sounds up to 6 s are judged whole, longer ones in 4 s windows. */
  readonly longS: number;
  readonly winS: number;
  /** Clips quieter than this RMS (dBFS) are not judged. */
  readonly silentDb: number;
  readonly heads: { readonly clap: RealnessHead; readonly signal: RealnessHead };
  readonly fusion: {
    readonly heads: readonly string[];
    readonly coef: readonly number[];
    readonly intercept: number;
  };
  /** Per clip (a sound up to 6 s, or one 4 s window). */
  readonly thresholds: RealnessThresholds;
  /** For the mean of a long file's windows. */
  readonly fileThresholds: RealnessThresholds;
  readonly prompts: { readonly real: readonly string[]; readonly synth: readonly string[] };
  readonly facts: readonly RealnessFact[];
}

interface RawModel {
  version: number;
  trained: string;
  long_s: number;
  win_s: number;
  silent_db: number;
  heads: { clap: RealnessHead; signal: RealnessHead };
  fusion: RealnessModel['fusion'];
  thresholds: RealnessThresholds;
  file_thresholds?: RealnessThresholds;
  prompts: RealnessModel['prompts'];
  facts?: RealnessFact[];
}

let model: RealnessModel | undefined;

/** The vendored model, parsed once. */
export function realnessModel(): RealnessModel {
  if (model) return model;
  const raw = modelFile as unknown as RawModel;
  model = {
    version: raw.version,
    trained: raw.trained,
    longS: raw.long_s,
    winS: raw.win_s,
    silentDb: raw.silent_db,
    heads: raw.heads,
    fusion: raw.fusion,
    thresholds: { lo: raw.thresholds.lo, hi: raw.thresholds.hi },
    fileThresholds: raw.file_thresholds
      ? { lo: raw.file_thresholds.lo, hi: raw.file_thresholds.hi }
      : { lo: raw.thresholds.lo, hi: raw.thresholds.hi },
    prompts: raw.prompts,
    facts: raw.facts ?? [],
  };
  return model;
}

/** The 12 prompts in upstream's order: the 6 real, then the 6 synthesized. */
export function realnessPrompts(m: RealnessModel = realnessModel()): string[] {
  return [...m.prompts.real, ...m.prompts.synth];
}

/** realness.thresholds_of: per clip, or for the mean of a long file's windows. */
export function thresholdsOf(m: RealnessModel, file = false): RealnessThresholds {
  return file ? m.fileThresholds : m.thresholds;
}

/** realness.head_logit: non-finite inputs read as the training mean, clipped, standardised, through the head. */
export function headLogit(h: RealnessHead, values: ArrayLike<number>): number {
  let s = h.intercept;
  for (let i = 0; i < h.coef.length; i++) {
    const mean = h.mean[i] ?? 0;
    let v = values[i] ?? Number.NaN;
    if (!Number.isFinite(v)) v = mean;
    if (h.clip) v = Math.min(Math.max(v, h.clip[0][i] ?? -Infinity), h.clip[1][i] ?? Infinity);
    s += ((v - mean) / (h.scale[i] ?? 1)) * (h.coef[i] ?? 0);
  }
  return s;
}

/** realness.fuse: p_real = sigmoid(intercept + Σ coef·logit). */
export function fuse(m: RealnessModel, logits: { readonly clap: number; readonly signal: number }): number {
  let s = m.fusion.intercept;
  m.fusion.heads.forEach((head, i) => {
    s += (m.fusion.coef[i] ?? 0) * (head === 'clap' ? logits.clap : head === 'signal' ? logits.signal : 0);
  });
  return 1 / (1 + Math.exp(-s));
}

export type UpstreamRealnessVerdict = 'real or pro-produced' | 'uncertain' | 'likely code-synthesized';

/** realness.verdict_of. */
export function verdictOf(p: number, m: RealnessModel, file = false): UpstreamRealnessVerdict {
  const t = thresholdsOf(m, file);
  return p >= t.hi ? 'real or pro-produced' : p <= t.lo ? 'likely code-synthesized' : 'uncertain';
}

/** The CLAP head's evidence: the closest of the 12 prompts (cosine; embeddings unit length) and the best other side. */
export function closestPrompt(
  embedding: ArrayLike<number>,
  prompts: readonly ArrayLike<number>[],
  m: RealnessModel = realnessModel(),
): { prompt: string; side: 'real' | 'synth'; cos: number; other: string; otherCos: number } | null {
  if (prompts.length === 0) return null;
  const names = realnessPrompts(m);
  const nReal = m.prompts.real.length;
  const cos = prompts.map((p) => {
    let s = 0;
    for (let i = 0; i < p.length; i++) s += (p[i] ?? 0) * (embedding[i] ?? 0);
    return s;
  });
  const order = cos.map((_, i) => i).sort((a, b) => (cos[b] ?? 0) - (cos[a] ?? 0) || a - b);
  const i = order[0] ?? 0;
  const j = order.find((k) => k < nReal !== i < nReal) ?? i;
  return {
    prompt: names[i] ?? '',
    side: i < nReal ? 'real' : 'synth',
    cos: cos[i] ?? 0,
    other: names[j] ?? '',
    otherCos: cos[j] ?? 0,
  };
}
