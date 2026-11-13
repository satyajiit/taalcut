// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sources ranked by how well each matches a description (earshot `search.rank`): each embedded once (up to 6 evenly
 * spaced 10 s windows), sorted by the description's calibrated z with near-silent sources last (verdict `no_match`,
 * their scores mean nothing). `vocabPercentile` is where the query ranks among the vocabulary for that source, not a
 * rank among the sources. A hint query (genre, mood, instrument, voice) gets no verdict.
 */
import { ok, type AsyncResult, type ListenVerdict } from '@taalcut/core';
import { topTerms, type TermScore } from '../calibrate/match';
import { calibrate, calibrateQuery } from '../calibrate/score';
import { roundTo, verdictFor } from '../calibrate/verdict';
import { dbOf, isNearSilent, peakOf, sourceAt, type ListenModels, type ListenSources } from './context';

export interface RankedSource {
  /** The source's position in the input. */
  readonly index: number;
  readonly name?: string;
  readonly z: number;
  readonly cosine: number;
  readonly vocabPercentile: number;
  readonly verdict: ListenVerdict | null;
  readonly nearSilent: boolean;
  /** Its best vocabulary description (quality and production left out). */
  readonly soundsMostLike: TermScore;
}

export interface SoundRanking {
  readonly query: string;
  readonly results: readonly RankedSource[];
  /** Verdict counts over the sources that aren't near-silent. */
  readonly counts: Readonly<Record<'strong' | 'plausible' | 'weak', number>>;
}

export async function rankSounds(
  models: ListenModels,
  sources: ListenSources,
  query: string,
  options: { readonly top?: number; readonly signal?: AbortSignal } = {},
): AsyncResult<SoundRanking> {
  const texts = await models.text.queries([query], options.signal);
  if (!texts.ok) return texts;
  const { vocab } = texts.value;
  const q = texts.value.queries[0]?.embedding ?? new Float32Array();
  const category = vocab.nearestCategory(q);
  const rows: RankedSource[] = [];
  for (let index = 0; index < sources.length; index++) {
    // One source decoded at a time (a lazy list keeps none): only its embedding and peak stay.
    const source = await sourceAt(sources, index, options.signal);
    if (!source.ok) return source;
    const { samples, name } = source.value;
    const embedded = await models.clap.embedSource(samples, undefined, options.signal);
    if (!embedded.ok) return embedded;
    const audio = embedded.value.pooled;
    const sound = calibrate(audio, vocab);
    const scored = calibrateQuery(sound, audio, q, vocab.biasOf(q));
    const z = roundTo(scored.z, 2);
    const nearSilent = isNearSilent(dbOf(peakOf(samples)));
    const best = topTerms(sound, vocab, 1, { exclude: ['quality', 'production'] })[0];
    rows.push({
      index,
      ...(name ? { name } : {}),
      z,
      cosine: roundTo(scored.cosine, 3),
      vocabPercentile: roundTo(scored.percentile, 1),
      verdict: nearSilent ? 'no_match' : verdictFor(z, category),
      nearSilent,
      soundsMostLike: best ?? { term: '', category: 'everyday', z: 0, cosine: 0 },
    });
  }
  const order = [...rows].sort((a, b) => Number(a.nearSilent) - Number(b.nearSilent) || b.z - a.z);
  const counts = { strong: 0, plausible: 0, weak: 0 };
  for (const row of order) {
    if (!row.nearSilent && row.verdict && row.verdict !== 'no_match') counts[row.verdict] += 1;
  }
  return ok({ query, results: options.top ? order.slice(0, options.top) : order, counts });
}
