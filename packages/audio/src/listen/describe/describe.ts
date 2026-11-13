// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a sound sounds like (earshot `describe.py`, the model half; measurements come from listen/dsp): calibrated
 * vocabulary tags (validated ones with a verdict, the unvalidated genre/mood/instrument/voice ones as hints), the
 * best three per category, AudioSet labels, AST's Music probability, the "character" (quality terms at z ≥ 2.5) and
 * the other readings. Over 20 s it reads up to 6 evenly spaced 10 s windows and also returns up to 3 that read
 * differently. Near silence (peak < −70 dBFS) and anything under 5 ms are reported untagged.
 */
import {
  HINT_CATEGORIES,
  SOUND_TAG_CATEGORIES,
  type AudioSetLabel,
  type ListenVerdict,
  type SoundTag,
  type SoundTagCategory,
} from '@taalcut/core';
import { ok, type AsyncResult } from '@taalcut/core';
import { topTerms, toSoundTag, type TermScore } from '../calibrate/match';
import { calibrate } from '../calibrate/score';
import { roundTo, verdictOf } from '../calibrate/verdict';
import type { ListenVocab } from '../calibrate/vocab';
import { LISTEN_CONFIG } from '../config';
import { topLabels } from '../models/ast';
import { meanUnit } from '../models/clap-audio';
import { clapSpans, spanSamples, type Span } from '../models/windows';
import {
  checkRange,
  isNearSilent,
  meanMono,
  peakDbfs,
  rangeSamples,
  type ListenModels,
  type ListenRange,
  type ListenSource,
} from './context';

const SR = LISTEN_CONFIG.sampleRate;
const LONG_S = 20;
const MIN_S = 0.005;
const { skip } = LISTEN_CONFIG.calibration;

export interface DistinctWindow {
  readonly start: number;
  readonly end: number;
  readonly topTag: SoundTag;
  readonly audioSet: readonly AudioSetLabel[];
}

export interface SoundDescription {
  readonly durationS: number;
  readonly peakDbfs: number;
  readonly nearSilent: boolean;
  /** Under 5 ms: too short to describe. */
  readonly tooShort: boolean;
  /** The best validated tags, best first, each with its verdict. */
  readonly tags: readonly SoundTag[];
  /** Genre, mood, instrument and voice tags: hints, never a verdict. */
  readonly hints: readonly SoundTag[];
  /** Up to 3 terms per category. */
  readonly perCategory: Partial<Record<SoundTagCategory, readonly TermScore[]>>;
  /** Up to 5 AudioSet labels (≥ 0.05, the first always). */
  readonly audioSet: readonly AudioSetLabel[];
  /** AST's Music; upstream reads the genre and mood hints only from 0.5. */
  readonly musicP: number | null;
  /** The best tag's band, or `tentative` when nothing stands out (z < 2). */
  readonly reading: ListenVerdict | 'tentative' | null;
  /** Up to 2 more tags from categories the top 3 don't cover. */
  readonly otherReadings: readonly SoundTag[];
  /** Quality words at z ≥ 2.5 ('bright', 'muffled'). */
  readonly character: readonly string[];
  /** Over 20 s: windows that read differently from each other. */
  readonly windows?: readonly DistinctWindow[];
}

export interface DescribeOptions {
  readonly range?: ListenRange;
  /** Tags per list (default 8). */
  readonly top?: number;
  readonly signal?: AbortSignal;
}

function untagged(durationS: number, dbfs: number, tooShort: boolean): SoundDescription {
  return {
    durationS,
    peakDbfs: dbfs,
    nearSilent: !tooShort,
    tooShort,
    tags: [],
    hints: [],
    perCategory: {},
    audioSet: [],
    musicP: null,
    reading: null,
    otherReadings: [],
    character: [],
  };
}

function astTop(probs: ArrayLike<number>, labels: readonly string[], k = 5, minP = 0.05): AudioSetLabel[] {
  return topLabels(probs, labels, k)
    .filter((entry, i) => roundTo(entry.p, 3) >= minP || i === 0)
    .map((entry) => ({ label: entry.label, score: roundTo(entry.p, 3) }));
}

/** describe._tags: validated tags, hints, and the best 3 per category. */
export function describeTags(audio: Float32Array, vocab: ListenVocab, top: number) {
  const sound = calibrate(audio, vocab);
  const all = topTerms(sound, vocab, vocab.terms.length, { exclude: skip });
  const hint = (t: TermScore) => (HINT_CATEGORIES as readonly string[]).includes(t.category);
  const tags = all.filter((t) => !hint(t)).slice(0, top);
  const hints = all.filter(hint).slice(0, top);
  const perCategory: Partial<Record<SoundTagCategory, TermScore[]>> = {};
  for (const category of SOUND_TAG_CATEGORIES) {
    perCategory[category] = topTerms(sound, vocab, 3, { categories: [category] });
  }
  return { tags, hints, perCategory };
}

/** describe.distinct_windows: farthest from the mean first, non-overlapping, each with a different top tag. */
export function distinctWindows(
  spans: readonly Span[],
  windows: readonly Float32Array[],
  tags: readonly string[],
  n = 3,
) {
  if (spans.length <= 1) return [];
  const mean = meanUnit(windows);
  const distance = windows.map((w) => 1 - w.reduce((sum, v, i) => sum + v * (mean[i] ?? 0), 0));
  const order = distance.map((_, i) => i).sort((a, b) => (distance[b] ?? 0) - (distance[a] ?? 0));
  const picked: number[] = [];
  for (const i of order) {
    if (picked.length >= n) break;
    const span = spans[i];
    if (!span) continue;
    const apart = picked.every((j) => {
      const other = spans[j] ?? span;
      return span[1] <= other[0] + 1e-6 || span[0] >= other[1] - 1e-6;
    });
    if (apart && !picked.some((j) => tags[j] === tags[i])) picked.push(i);
  }
  return picked.length > 1 ? picked.sort((a, b) => a - b) : [];
}

export async function describeSound(
  models: ListenModels,
  source: ListenSource,
  options: DescribeOptions = {},
): AsyncResult<SoundDescription> {
  const checked = checkRange(source, options.range);
  if (!checked.ok) return checked;
  const segment = rangeSamples(source.samples, options.range);
  const durationS = segment.length / SR;
  const dbfs = peakDbfs(source, options.range);
  if (durationS < MIN_S) return ok(untagged(durationS, dbfs, true));
  if (isNearSilent(dbfs)) return ok(untagged(durationS, dbfs, false));
  const vocab = await models.text.vocab(options.signal);
  if (!vocab.ok) return vocab;
  const labels = await models.ast.labels(options.signal);
  if (!labels.ok) return labels;
  const top = options.top ?? 8;
  const start = Math.max(0, options.range?.start ?? 0);
  let audio: Float32Array;
  let probs: Float32Array;
  let long: { spans: Span[]; windows: Float32Array[]; probs: Float32Array[] } | undefined;
  if (durationS > LONG_S) {
    const spans = clapSpans(start, start + durationS);
    const embedded = await models.clap.embedSegments(
      spans.map((span) => spanSamples(source.samples, span)),
      options.signal,
    );
    if (!embedded.ok) return embedded;
    const mono = rangeSamples(meanMono(source), options.range);
    const crops = spans.map(([a, b]) =>
      mono.subarray(Math.trunc((a - start) * SR), Math.trunc((b - start) * SR)),
    );
    const tagged = await models.ast.probs(crops, { signal: options.signal });
    if (!tagged.ok) return tagged;
    audio = meanUnit(embedded.value);
    const perSpan = tagged.value.map((r) => r.probs);
    probs = Float32Array.from(perSpan[0] ?? [], (_, c) => Math.max(...perSpan.map((p) => p[c] ?? 0)));
    long = { spans, windows: embedded.value, probs: perSpan };
  } else {
    const embedded = await models.clap.embedSource(source.samples, options.range, options.signal);
    if (!embedded.ok) return embedded;
    const tagged = await models.ast.probs([segment], { signal: options.signal });
    if (!tagged.ok) return tagged;
    audio = embedded.value.pooled;
    probs = tagged.value[0]?.probs ?? new Float32Array();
  }
  const { tags, hints, perCategory } = describeTags(audio, vocab.value, top);
  const seen = new Set(tags.slice(0, 3).map((t) => t.category));
  const otherReadings: SoundTag[] = [];
  for (const tag of tags.slice(3)) {
    if (otherReadings.length >= 2 || seen.has(tag.category)) continue;
    otherReadings.push(toSoundTag(tag));
    seen.add(tag.category);
  }
  const character = (perCategory.quality ?? [])
    .filter((t) => t.z >= LISTEN_CONFIG.calibration.verdicts.plausible)
    .map((t) => (t.term.split(' ').slice(1).join(' ') || t.term).replace(/ sound$/, ''))
    .slice(0, 2);
  const music = labels.value.indexOf('Music');
  const best = tags[0];
  let windows: DistinctWindow[] | undefined;
  if (long) {
    const { spans, windows: rows, probs: perSpan } = long;
    const windowTags = rows.map((row) => describeTags(row, vocab.value, 1).tags[0]);
    windows = distinctWindows(
      spans,
      rows,
      windowTags.map((t) => t?.term ?? ''),
    ).map((i) => ({
      start: roundTo(spans[i]?.[0] ?? 0, 3),
      end: roundTo(spans[i]?.[1] ?? 0, 3),
      topTag: toSoundTag(windowTags[i] ?? tags[0] ?? { term: '', category: 'everyday', z: 0, cosine: 0 }),
      audioSet: astTop(perSpan[i] ?? [], labels.value, 3, 0.1),
    }));
  }
  return ok({
    durationS,
    peakDbfs: dbfs,
    nearSilent: false,
    tooShort: false,
    tags: tags.map(toSoundTag),
    hints: hints.map(toSoundTag),
    perCategory,
    audioSet: astTop(probs, labels.value),
    musicP: music >= 0 ? (probs[music] ?? 0) : null,
    reading: best && best.z >= LISTEN_CONFIG.calibration.verdicts.weak ? verdictOf(best.z) : 'tentative',
    otherReadings,
    character,
    ...(windows ? { windows } : {}),
  });
}
