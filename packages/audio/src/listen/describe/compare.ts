// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sounds against each other and against references (earshot `compare.py`): the nearest references by CLAP cosine,
 * typicality (how close a sound is to its k nearest references against how close the references are to each other:
 * z ≥ −1 fits the set, below −2 is an outlier), and A/B: which of two is closer to a description or the references
 * (none below a 0.3 z difference), how alike they are, and how B differs from A in measured terms, in words.
 *
 * The measurements (`CompareFeatures`, compare.feats: active loudness, brightness, attack, tail, low end, length,
 * noise floor, width, top end) come from listen/dsp's measure; this file turns them into the words.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { calibrate, calibrateQuery } from '../calibrate/score';
import { roundTo } from '../calibrate/verdict';
import { dot } from '../calibrate/vocab';
import { ListenBadInput } from '../errors';
import {
  sourceAt,
  type ListenModels,
  type ListenRange,
  type ListenSource,
  type ListenSources,
} from './context';

export type FeatureKey =
  | 'loudness_lufs'
  | 'peak_dbfs'
  | 'brightness_hz'
  | 'bandwidth_hz'
  | 'attack_ms'
  | 'decay_ms'
  | 'length_s'
  | 'noise_floor_dbfs'
  | 'width_db'
  | 'low_end_db';
export type CompareFeatures = Partial<Record<FeatureKey | 'duration', number>>;

const DIFFS: readonly (readonly [FeatureKey, number, 'db' | 'ratio'])[] = [
  ['loudness_lufs', 1.5, 'db'],
  ['brightness_hz', 1.15, 'ratio'],
  ['attack_ms', 1.5, 'ratio'],
  ['decay_ms', 1.5, 'ratio'],
  ['low_end_db', 3.0, 'db'],
  ['length_s', 1.25, 'ratio'],
  ['noise_floor_dbfs', 6.0, 'db'],
  ['width_db', 6.0, 'db'],
  ['bandwidth_hz', 1.4, 'ratio'],
];
const WORDS: Readonly<Record<FeatureKey, readonly [string, string]>> = {
  loudness_lufs: ['louder', 'quieter'],
  brightness_hz: ['brighter', 'darker'],
  bandwidth_hz: ['more top end', 'less top end'],
  attack_ms: ['a softer attack', 'a sharper attack'],
  decay_ms: ['a longer tail', 'a shorter tail'],
  noise_floor_dbfs: ['noisier', 'cleaner'],
  length_s: ['longer', 'shorter'],
  low_end_db: ['more low end', 'less low end'],
  width_db: ['wider', 'narrower'],
  peak_dbfs: ['hotter peaks', 'lower peaks'],
};
const WITH = new Set<FeatureKey>(['attack_ms', 'decay_ms', 'low_end_db', 'bandwidth_hz']);
const LABEL: Partial<Record<FeatureKey, string>> = {
  brightness_hz: 'brightness',
  bandwidth_hz: 'bandwidth',
  noise_floor_dbfs: 'noise floor',
  width_db: 'side/mid',
  low_end_db: 'energy below 250 Hz',
  loudness_lufs: 'loudness',
  length_s: 'sounding length',
};
const MONO_DB = -40;
const CLOSE_DZ = 0.3;

const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${f.toFixed(0)} Hz`);
const ms = (v: number) => (v >= 2000 ? `${(v / 1000).toFixed(1)} s` : `${v.toFixed(0)} ms`);

function format(key: FeatureKey, v: number): string {
  if (key === 'brightness_hz' || key === 'bandwidth_hz') return hz(v);
  if (key === 'attack_ms' || key === 'decay_ms') return ms(v);
  if (key === 'length_s') return `${v.toFixed(2)} s`;
  if (key === 'width_db' && v <= MONO_DB) return 'mono';
  const unit =
    key === 'loudness_lufs' ? 'LUFS' : key === 'noise_floor_dbfs' || key === 'peak_dbfs' ? 'dBFS' : 'dB';
  return `${v.toFixed(0)} ${unit}`;
}

function phrase(key: FeatureKey, up: boolean, a: string, b: string): string {
  const label = LABEL[key];
  return `${WITH.has(key) ? 'with ' : ''}${WORDS[key][up ? 0 : 1]} (${label ? `${label} ` : ''}${b} vs ${a})`;
}

/** compare.differences: B against A, the `limit` most important differences big enough to hear, in words. */
export function differences(
  a: CompareFeatures,
  b: CompareFeatures,
  limit = 4,
): { keys: FeatureKey[]; words: string } {
  const out: [FeatureKey, string][] = [];
  for (const [key, threshold, kind] of DIFFS) {
    const va = a[key];
    const vb = b[key];
    if (va === undefined || vb === undefined) continue;
    if (kind === 'db') {
      if (Math.abs(vb - va) < threshold) continue;
      out.push([
        key,
        key === 'loudness_lufs'
          ? `${Math.abs(vb - va).toFixed(0)} dB ${WORDS[key][vb > va ? 0 : 1]}`
          : phrase(key, vb > va, format(key, va), format(key, vb)),
      ]);
    } else if (Math.min(va, vb) > 0 && Math.max(va, vb) / Math.min(va, vb) >= threshold) {
      if (key === 'attack_ms' && Math.abs(va - vb) < 3) continue;
      out.push([key, phrase(key, vb > va, format(key, va), format(key, vb))]);
    }
  }
  const kept = out.slice(0, limit);
  const parts = [
    ...kept.filter(([, p]) => !p.startsWith('with ')),
    ...kept.filter(([, p]) => p.startsWith('with ')),
  ];
  if (parts.length === 0) {
    return {
      keys: [],
      words: 'no measurable difference big enough to hear (level, brightness, envelope, low end, noise)',
    };
  }
  const texts = parts.map(([, p]) => p);
  const words =
    texts.length === 1 ? (texts[0] ?? '') : `${texts.slice(0, -1).join(', ')} and ${texts.at(-1) ?? ''}`;
  return { keys: kept.map(([key]) => key), words };
}

export interface Typicality {
  /** The mean cosine to the k nearest references. */
  readonly meanCosKnn: number;
  readonly z: number;
  readonly percentile: number;
}

/** compare._typicality. */
export function typicality(sound: Float32Array, refs: readonly Float32Array[], k: number): Typicality {
  const kk = Math.max(1, Math.min(k, refs.length - 1));
  const topMean = (values: number[]) =>
    values
      .sort((x, y) => y - x)
      .slice(0, kk)
      .reduce((s, v) => s + v, 0) / kk;
  const refScores = refs.map((r, i) => topMean(refs.flatMap((o, j) => (i === j ? [] : [dot(r, o)]))));
  const sx = topMean(refs.map((r) => dot(r, sound)));
  const mean = refScores.reduce((s, v) => s + v, 0) / refScores.length;
  const sd = Math.sqrt(refScores.reduce((s, v) => s + (v - mean) ** 2, 0) / refScores.length) + 1e-6;
  return {
    meanCosKnn: sx,
    z: (sx - mean) / sd,
    percentile: (100 * refScores.filter((v) => v <= sx).length) / refScores.length,
  };
}

/** Typicality in words (compare._fit_words). */
export const fitWords = (z: number): 'fits the set' | 'somewhat unusual for the set' | 'an outlier' =>
  z >= -1 ? 'fits the set' : z >= -2 ? 'somewhat unusual for the set' : 'an outlier';

/** `ab._closer`: which is closer, none below a 0.3 difference. */
export const closer = (za: number, zb: number): 'a' | 'b' | null =>
  Math.abs(za - zb) < CLOSE_DZ ? null : zb > za ? 'b' : 'a';

/** How alike two sounds are by CLAP cosine. */
export const likeness = (cos: number) =>
  cos >= 0.9
    ? 'nearly the same sound'
    : cos >= 0.75
      ? 'similar'
      : cos >= 0.5
        ? 'related'
        : 'different sounds';

/** Each source's pooled embedding, one decoded at a time (a lazy list keeps none). */
async function embedAll(
  models: ListenModels,
  sources: ListenSources,
  signal?: AbortSignal,
): AsyncResult<Float32Array[]> {
  const rows: Float32Array[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = await sourceAt(sources, i, signal);
    if (!source.ok) return source;
    const r = await models.clap.embedSource(source.value.samples, undefined, signal);
    if (!r.ok) return r;
    rows.push(r.value.pooled);
  }
  return ok(rows);
}

export interface SoundComparison {
  readonly nearest: readonly { readonly index: number; readonly cosine: number }[];
  readonly typicality: Typicality & { readonly k: number; readonly fit: ReturnType<typeof fitWords> };
}

export async function compareSound(
  models: ListenModels,
  source: ListenSource,
  refs: ListenSources,
  options: { readonly k?: number; readonly range?: ListenRange; readonly signal?: AbortSignal } = {},
): AsyncResult<SoundComparison> {
  if (refs.length < 2) return err(ListenBadInput(undefined, { detail: 'need at least 2 reference sounds' }));
  const k = options.k ?? 5;
  const a = await models.clap.embedSource(source.samples, options.range, options.signal);
  if (!a.ok) return a;
  const rows = await embedAll(models, refs, options.signal);
  if (!rows.ok) return rows;
  const cos = rows.value.map((row) => dot(row, a.value.pooled));
  const order = cos.map((_, i) => i).sort((x, y) => (cos[y] ?? 0) - (cos[x] ?? 0));
  const typical = typicality(a.value.pooled, rows.value, k);
  return ok({
    nearest: order.slice(0, k).map((index) => ({ index, cosine: roundTo(cos[index] ?? 0, 3) })),
    typicality: { ...typical, k, fit: fitWords(typical.z) },
  });
}

export interface AbComparison {
  readonly cosineAb: number;
  readonly likeness: ReturnType<typeof likeness>;
  readonly query?: {
    readonly query: string;
    readonly za: number;
    readonly zb: number;
    readonly closer: 'a' | 'b' | null;
  };
  readonly refs?: { readonly a: Typicality; readonly b: Typicality; readonly closer: 'a' | 'b' | null };
  /** From the two sounds' measurements, when given. */
  readonly differences?: { readonly keys: readonly FeatureKey[]; readonly words: string };
}

export async function abSounds(
  models: ListenModels,
  a: ListenSource,
  b: ListenSource,
  options: {
    readonly query?: string;
    readonly refs?: ListenSources;
    readonly k?: number;
    readonly aRange?: ListenRange;
    readonly bRange?: ListenRange;
    readonly features?: readonly [CompareFeatures, CompareFeatures];
    readonly signal?: AbortSignal;
  } = {},
): AsyncResult<AbComparison> {
  const ea = await models.clap.embedSource(a.samples, options.aRange, options.signal);
  if (!ea.ok) return ea;
  const eb = await models.clap.embedSource(b.samples, options.bRange, options.signal);
  if (!eb.ok) return eb;
  const cosineAb = roundTo(dot(ea.value.pooled, eb.value.pooled), 3);
  let query: AbComparison['query'];
  if (options.query) {
    const texts = await models.text.queries([options.query], options.signal);
    if (!texts.ok) return texts;
    const q = texts.value.queries[0]?.embedding ?? new Float32Array();
    const bias = texts.value.vocab.biasOf(q);
    const zOf = (audio: Float32Array) =>
      roundTo(calibrateQuery(calibrate(audio, texts.value.vocab), audio, q, bias).z, 2);
    const za = zOf(ea.value.pooled);
    const zb = zOf(eb.value.pooled);
    query = { query: options.query, za, zb, closer: closer(za, zb) };
  }
  let refs: AbComparison['refs'];
  if (options.refs && options.refs.length >= 2) {
    const rows = await embedAll(models, options.refs, options.signal);
    if (!rows.ok) return rows;
    const ta = typicality(ea.value.pooled, rows.value, options.k ?? 5);
    const tb = typicality(eb.value.pooled, rows.value, options.k ?? 5);
    refs = { a: ta, b: tb, closer: closer(ta.z, tb.z) };
  }
  return ok({
    cosineAb,
    likeness: likeness(cosineAb),
    ...(query ? { query } : {}),
    ...(refs ? { refs } : {}),
    ...(options.features ? { differences: differences(options.features[0], options.features[1]) } : {}),
  });
}
