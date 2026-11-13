// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The best moments for a description inside one long recording (earshot `search.find` at ff41f07), as sample trims.
 *
 * - **What the query is.** CLAP text similarity to one-shot vs continuous anchor phrases: `event` (≥ −0.08),
 *   `texture` (≤ −0.27), else `either`. One-shot queries score windows snapped onto the sound plus strokes and events;
 *   continuous ones plain windows only; `either` all of them, unsnapped.
 * - **Candidates** (listen/search): sliding windows, and up to 48 strokes / events picked round-robin over 2 s
 *   stretches. Over 60 s, two stages: the windows first, then the strokes / events inside the 6 best windows.
 * - **Scores.** Each candidate is one CLAP window (repeat-padded) calibrated like any sound (z over the vocabulary). A
 *   trim that cuts into a sound (first 5 ms or last 10 ms within 15 dB of its peak) ranks 0.5 z lower. For one-shot
 *   queries a window holding two separate sounds is never returned, nor one whose best stroke / event inside it
 *   scores within 0.5 z (the tighter trim wins). A near-silent stretch of a sounding file is never an answer.
 *
 * Candidates don't depend on the query, so their embeddings can be kept per source (`spans`) and reused.
 */
import { CancelledError, err, ok, type AsyncResult, type ListenVerdict } from '@taalcut/core';
import { EVENT_ANCHORS, TEXTURE_ANCHORS } from '../calibrate/phrase-sets';
import { calibrate, calibrateQuery } from '../calibrate/score';
import { isBorderline, roundTo, verdictFor } from '../calibrate/verdict';
import { dot, type ListenVocab } from '../calibrate/vocab';
import { LISTEN_CONFIG } from '../config';
import { pyRound } from '../dsp/pcm';
import { ListenBadInput } from '../errors';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { percentile } from '../dsp/stats';
import { envDb, FIND, headDb, multiSound, tailDb } from '../search/envelope';
import { eventCandidates, librosaOnsets } from '../search/events';
import { dedupe, selectRoundRobin, snapWindow, windowCandidates, type Candidate } from '../search/windows';
import {
  checkRange,
  dbOf,
  isNearSilent,
  peakOf,
  rangeSamples,
  type ListenModels,
  type ListenRange,
  type ListenSource,
} from './context';

const SR = LISTEN_CONFIG.sampleRate;

export const FIND_KINDS = ['auto', 'event', 'texture'] as const;
export type FindKind = (typeof FIND_KINDS)[number];
export type QueryKind = 'event' | 'texture' | 'either';

/** Embeddings of candidate spans of one source, by `"<first sample>:<end sample>"`: query-independent. */
export type SpanEmbeddings = Map<string, Float32Array>;

export interface FindOptions {
  /** Non-overlapping moments to return (default 5). */
  readonly top?: number;
  readonly kind?: FindKind;
  /** Window length and hop, s (defaults: duration / 6 clamped to 1–5 s, half of it). */
  readonly win?: number;
  readonly hop?: number;
  /** Search only here; only moments whose attack lies inside are returned. */
  readonly range?: ListenRange;
  /** For the onsets (the spectrogram graphs on the listen device plan). */
  readonly runner: SpectrogramRunner;
  /** Keep this per source to reuse candidate embeddings across queries. */
  readonly spans?: SpanEmbeddings;
  readonly signal?: AbortSignal;
}

export interface FoundMoment {
  /** Sample trims, s from the source's start: strokes / events start 5 ms before the attack. */
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly kind: Candidate['kind'];
  /** z less 0.5 for a cut trim: what it was ranked by. */
  readonly score: number;
  readonly z: number;
  readonly cosine: number;
  /** Null for a hint query (genre, mood, instrument, voice). */
  readonly verdict: ListenVerdict | null;
  readonly borderline: boolean;
  readonly peakDbfs: number;
  /** The first 5 ms and the last 10 ms against the segment's peak, dB. */
  readonly headDb: number;
  readonly tailDb: number;
  /** Judged trims only: the trim cuts into a sound. */
  readonly headCut: boolean;
  readonly tailCut: boolean;
}

export interface FoundMoments {
  readonly query: string;
  readonly queryKind: QueryKind;
  readonly queryKindScore: number;
  readonly kind: FindKind;
  /** The searched span, s. */
  readonly durationS: number;
  readonly candidates: number;
  readonly windows: number;
  /** The grid's windows before snapping and de-duplication. */
  readonly plannedWindows: number;
  readonly events: number;
  readonly windowS: number;
  /** Window edges snapped onto the sound (one-shot queries). */
  readonly snapped: boolean;
  /** Over 60 s: strokes / events only inside the best windows. */
  readonly twoStage: boolean;
  /** Peak under −70 dBFS: the scores mean nothing. */
  readonly nearSilent: boolean;
  readonly moments: readonly FoundMoment[];
}

/** `query_kind`: q·mean(one-shot anchors) − q·mean(continuous anchors), and what that reads as. */
export function queryKindOf(
  q: Float32Array,
  anchors: readonly Float32Array[],
): { readonly kind: QueryKind; readonly score: number } {
  const n = EVENT_ANCHORS.length;
  const meanDot = (rows: readonly Float32Array[]) =>
    rows.reduce((s, row) => s + dot(q, row), 0) / rows.length;
  const d = meanDot(anchors.slice(0, n)) - meanDot(anchors.slice(n));
  const kind = d >= FIND.kindEvent ? 'event' : d <= FIND.kindTexture ? 'texture' : 'either';
  return { kind, score: roundTo(d, 3) };
}

interface Scored {
  readonly z: number[];
  readonly cos: number[];
}

/** `_score`: each candidate span (local seconds + m0) embedded as one CLAP window and calibrated against `q`. */
async function scoreSpans(
  models: ListenModels,
  source: ListenSource,
  m0: number,
  cands: readonly Candidate[],
  q: { readonly embedding: Float32Array; readonly vocab: ListenVocab },
  options: FindOptions,
): AsyncResult<Scored> {
  const spans = options.spans ?? new Map<string, Float32Array>();
  const keys = cands.map((c) => `${pyRound((m0 + c.start) * SR)}:${pyRound((m0 + c.end) * SR)}`);
  const todo = [...new Set(keys.filter((key) => !spans.has(key)))];
  if (todo.length > 0) {
    const segments = todo.map((key) => {
      const [a, b] = key.split(':').map(Number) as [number, number];
      return source.samples.subarray(Math.min(a, source.samples.length), Math.min(b, source.samples.length));
    });
    const embedded = await models.clap.embedSegments(segments, options.signal);
    if (!embedded.ok) return embedded;
    todo.forEach((key, i) => spans.set(key, embedded.value[i] ?? new Float32Array()));
  }
  const bias = q.vocab.biasOf(q.embedding);
  const z: number[] = [];
  const cos: number[] = [];
  for (const key of keys) {
    const audio = spans.get(key) ?? new Float32Array();
    const scored = calibrateQuery(calibrate(audio, q.vocab), audio, q.embedding, bias);
    z.push(scored.z);
    cos.push(scored.cosine);
  }
  return ok({ z, cos });
}

/** Indices by value, highest first; ties keep their order (NumPy's argsort of −v, made stable). */
const descending = (values: readonly number[]) =>
  values.map((_, i) => i).sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0) || a - b);

export async function findMoments(
  models: ListenModels,
  source: ListenSource,
  query: string,
  options: FindOptions,
): AsyncResult<FoundMoments> {
  const kind = options.kind ?? 'auto';
  const top = options.top ?? 5;
  if (!query.trim()) return err(ListenBadInput(undefined, { detail: 'no query given' }));
  const checked = checkRange(source, options.range);
  if (!checked.ok) return checked;
  const full = source.samples.length / SR;
  const s0 = options.range?.start ?? 0;
  const s1 = options.range?.end !== undefined ? Math.min(options.range.end, full) : full;
  const m0 = Math.max(0, s0 - FIND.margin);
  const x = rangeSamples(source.samples, { start: m0, end: s1 });
  const off = s0 - m0;
  const dur = x.length / SR;

  const texts = await models.text.queries([query], options.signal);
  if (!texts.ok) return texts;
  const vocab = texts.value.vocab;
  const q = texts.value.queries[0]?.embedding ?? new Float32Array();
  const anchors = await models.text.queries([...EVENT_ANCHORS, ...TEXTURE_ANCHORS], options.signal);
  if (!anchors.ok) return anchors;
  const qkind = queryKindOf(
    q,
    anchors.value.queries.map((a) => a.embedding),
  );
  const useEv = kind === 'event' || (kind === 'auto' && qkind.kind !== 'texture');
  const preferEv = kind === 'event' || (kind === 'auto' && qkind.kind === 'event');

  const env = envDb(x);
  const floor = percentile(env, 10);
  let wins: Candidate[] = windowCandidates(dur, options.win, options.hop, off);
  const nWin = wins.length;
  const winS = (wins[0]?.end ?? 0) - (wins[0]?.start ?? 0);
  if (preferEv) {
    wins = dedupe(
      wins.map((w) => {
        const [start, end] = snapWindow(env, floor, w.start, w.end, off, dur);
        return { ...w, start, end };
      }),
    );
  }
  const target = { embedding: q, vocab };
  const zw = await scoreSpans(models, source, m0, wins, target, options);
  if (!zw.ok) return zw;
  if (options.signal?.aborted) return err(CancelledError());

  let evs: Candidate[] = [];
  let twoStage = false;
  if (useEv) {
    const onsets = await librosaOnsets(x, options.runner);
    const all = eventCandidates(env, envDb(x, 0.001), floor, onsets, dur).filter(
      (c) => c.start + FIND.preRoll >= off - 1e-3,
    );
    if (s1 - s0 <= FIND.singleStageS) evs = selectRoundRobin(all);
    else {
      const best = descending(zw.value.z)
        .slice(0, FIND.topWindows)
        .map((i) => wins[i] as Candidate);
      evs = selectRoundRobin(all.filter((c) => best.some((w) => c.start < w.end && c.end > w.start)));
      twoStage = true;
    }
  }
  evs = dedupe(evs);
  const ze = await scoreSpans(models, source, m0, evs, target, options);
  if (!ze.ok) return ze;
  let winScores = zw.value;
  if (kind === 'event' && evs.length > 0) {
    wins = [];
    winScores = { z: [], cos: [] };
  }

  const cands = [...evs, ...wins];
  const z = [...ze.value.z, ...winScores.z].map((v) => roundTo(v, 2));
  const cos = [...ze.value.cos, ...winScores.cos];
  const tails = cands.map((c) => tailDb(env, c.start, c.end));
  const heads = cands.map((c) => headDb(env, c.start, c.end));
  const judged = cands.map((c) => useEv && (preferEv || c.kind !== 'window'));
  const cut = cands.map(
    (_, i) => judged[i] && ((tails[i] ?? 0) > FIND.cutDb || (heads[i] ?? 0) > FIND.cutDb),
  );
  const score = z.map((v, i) => v - (cut[i] ? FIND.tailPenalty : 0));
  const rankZ = [...score];
  if (preferEv) {
    cands.forEach((c, i) => {
      if (c.kind !== 'window') return;
      const inside = cands
        .map((d, j) =>
          d.kind !== 'window' && d.start >= c.start - 0.05 && d.end <= c.end + 0.05 ? z[j] : undefined,
        )
        .filter((v): v is number => v !== undefined);
      const refined = inside.length > 0 && Math.max(...inside) >= (z[i] ?? 0) - FIND.refineDz;
      if (refined || (evs.length > 0 && multiSound(env, floor, c.start, c.end))) rankZ[i] = -Infinity;
    });
  }

  const filePeak = options.range || source.peakDbfs === undefined ? dbOf(peakOf(x)) : source.peakDbfs;
  const category = vocab.nearestCategory(q);
  const picked: FoundMoment[] = [];
  const taken: Array<[number, number]> = [];
  for (const i of descending(rankZ)) {
    if (!Number.isFinite(rankZ[i] ?? -Infinity)) break;
    const c = cands[i] as Candidate;
    const free = taken.every(([a, b]) => c.end <= a + 1e-3 || c.start >= b - 1e-3);
    if (!free) continue;
    const peak = dbOf(peakOf(x.subarray(Math.trunc(c.start * SR), Math.trunc(c.end * SR))));
    if (!isNearSilent(filePeak) && isNearSilent(peak)) continue;
    const zi = z[i] ?? 0;
    const verdict = verdictFor(zi, category);
    taken.push([c.start, c.end]);
    picked.push({
      start: roundTo(m0 + c.start, 3),
      end: roundTo(m0 + c.end, 3),
      duration: roundTo(c.end - c.start, 3),
      kind: c.kind,
      score: roundTo(score[i] ?? 0, 2),
      z: zi,
      cosine: roundTo(cos[i] ?? 0, 3),
      verdict,
      borderline: verdict !== null && isBorderline(zi),
      peakDbfs: roundTo(peak, 1),
      headDb: roundTo(heads[i] ?? 0, 1),
      tailDb: roundTo(tails[i] ?? 0, 1),
      headCut: Boolean(judged[i]) && (heads[i] ?? 0) > FIND.cutDb,
      tailCut: Boolean(judged[i]) && (tails[i] ?? 0) > FIND.cutDb,
    });
    if (picked.length >= top) break;
  }
  return ok({
    query,
    queryKind: qkind.kind,
    queryKindScore: qkind.score,
    kind,
    durationS: roundTo(s1 - s0, 3),
    candidates: cands.length,
    windows: wins.length,
    plannedWindows: nWin,
    events: evs.length,
    windowS: roundTo(winS, 2),
    snapped: preferEv,
    twoStage,
    nearSilent: isNearSilent(filePeak),
    moments: picked,
  });
}
