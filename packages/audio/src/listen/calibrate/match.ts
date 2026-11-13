// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Descriptions scored against one sound (earshot `match.score_queries`, `Vocab.top_terms`). Like upstream, the
 * reported cosine is rounded to 3 decimals and z to 2, the verdict is judged on that z, and `pVsAlts` is the softmax
 * (CLAP's `logit_scale`) of the rounded cosines: the query against its alternatives, or, with several queries and no
 * alternatives, the queries against each other. A query's category is its nearest vocabulary term's; a hint
 * category's query is a hint with no verdict.
 */
import { isHintCategory, type ListenVerdict, type SoundTag, type SoundTagCategory } from '@taalcut/core';
import { calibrate, calibrateQuery, type SoundCalibration } from './score';
import { isBorderline, roundTo, softmax, verdictFor } from './verdict';
import type { ListenVocab } from './vocab';

export interface EmbeddedText {
  readonly text: string;
  /** The template-averaged unit embedding (`Vocab.embed_text`). */
  readonly embedding: Float32Array;
}

export interface AltScore {
  readonly query: string;
  readonly p: number;
  readonly z: number;
  readonly cosine: number;
}

export interface QueryScore {
  readonly query: string;
  /** The nearest vocabulary term's category (what kind of description this is). */
  readonly category: SoundTagCategory;
  readonly hint: boolean;
  /** Rounded as upstream reports it: cosine 3 decimals, z 2, percentile 1. */
  readonly cosine: number;
  readonly z: number;
  readonly percentile: number;
  readonly rankInVocab: number;
  readonly vocabSize: number;
  /** Null for a hint. */
  readonly verdict: ListenVerdict | null;
  readonly borderline: boolean;
  /** Null when there is nothing to choose between (one query, no alternatives). */
  readonly pVsAlts: number | null;
  readonly alts?: readonly AltScore[];
}

export interface TermScore {
  readonly term: string;
  readonly category: SoundTagCategory;
  readonly z: number;
  readonly cosine: number;
}

interface Row {
  readonly query: string;
  readonly cosine: number;
  readonly z: number;
  readonly percentile: number;
  readonly rankInVocab: number;
  readonly vocabSize: number;
}

function rows(
  sound: SoundCalibration,
  audio: Float32Array,
  texts: readonly EmbeddedText[],
  vocab: ListenVocab,
): Row[] {
  return texts.map((text) => {
    const q = calibrateQuery(sound, audio, text.embedding, vocab.biasOf(text.embedding));
    return {
      query: text.text,
      cosine: roundTo(q.cosine, 3),
      z: roundTo(q.z, 2),
      percentile: roundTo(q.percentile, 1),
      rankInVocab: q.rankInVocab,
      vocabSize: q.vocabSize,
    };
  });
}

/** `score_queries(a, queries, alts)`, in the queries' order. */
export function scoreQueries(
  audio: Float32Array,
  queries: readonly EmbeddedText[],
  vocab: ListenVocab,
  alts: readonly EmbeddedText[] = [],
  sound: SoundCalibration = calibrate(audio, vocab),
): QueryScore[] {
  const scored = rows(sound, audio, queries, vocab);
  const altRows = rows(sound, audio, alts, vocab);
  const scale = vocab.stats.logitScale;
  const multi =
    scored.length > 1 && alts.length === 0
      ? softmax(
          scored.map((r) => r.cosine),
          scale,
        )
      : undefined;
  return scored.map((row, i) => {
    const category = vocab.nearestCategory(queries[i]?.embedding ?? new Float32Array());
    const base = {
      ...row,
      category,
      hint: isHintCategory(category),
      verdict: verdictFor(row.z, category),
      borderline: isBorderline(row.z),
    };
    if (altRows.length === 0) return { ...base, pVsAlts: multi ? roundTo(multi[i] ?? 0, 3) : null };
    const p = softmax([row.cosine, ...altRows.map((alt) => alt.cosine)], scale);
    return {
      ...base,
      pVsAlts: roundTo(p[0] ?? 0, 3),
      alts: altRows.map((alt, j) => ({
        query: alt.query,
        p: roundTo(p[j + 1] ?? 0, 3),
        z: alt.z,
        cosine: alt.cosine,
      })),
    };
  });
}

/** `Vocab.top_terms`: the best calibrated terms for one sound, z descending, within `categories`, minus `exclude`. */
export function topTerms(
  sound: SoundCalibration,
  vocab: ListenVocab,
  k: number,
  options: { readonly categories?: readonly string[]; readonly exclude?: readonly string[] } = {},
): TermScore[] {
  const order = Array.from(sound.z.keys()).sort((a, b) => (sound.z[b] ?? 0) - (sound.z[a] ?? 0));
  const out: TermScore[] = [];
  for (const i of order) {
    const category = vocab.categories[i];
    if (!category) continue;
    if (options.categories && !options.categories.includes(category)) continue;
    if (options.exclude?.includes(category)) continue;
    out.push({
      term: vocab.terms[i] ?? '',
      category,
      z: roundTo(sound.z[i] ?? 0, 2),
      cosine: roundTo(sound.cos[i] ?? 0, 3),
    });
    if (out.length >= k) break;
  }
  return out;
}

/** A term or query as core's SoundTag (hints have no verdict). */
export function toSoundTag(score: TermScore | QueryScore): SoundTag {
  const term = 'term' in score ? score.term : score.query;
  const hint = isHintCategory(score.category);
  return {
    term,
    category: score.category,
    cosine: score.cosine,
    z: score.z,
    verdict: verdictFor(score.z, score.category),
    hint,
    borderline: isBorderline(score.z),
    ...('pVsAlts' in score && score.pVsAlts !== null ? { pVsAlts: score.pVsAlts } : {}),
  };
}
