// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How well a sound matches one or more descriptions (earshot `match.match`): calibrated z, the verdict band (none for
 * a hint), where each would rank among the vocabulary's 322 descriptions, `pVsAlts` (a forced choice against the
 * alternatives, or among the queries), and the closest vocabulary descriptions. Rows are sorted by z, best first.
 * A near-silent sound (peak < −70 dBFS) is flagged: its scores mean nothing.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { scoreQueries, topTerms, type QueryScore, type TermScore } from '../calibrate/match';
import { calibrate } from '../calibrate/score';
import { LISTEN_CONFIG } from '../config';
import { ListenBadInput } from '../errors';
import {
  checkRange,
  isNearSilent,
  peakDbfs,
  type ListenModels,
  type ListenRange,
  type ListenSource,
} from './context';

export interface SoundMatch {
  /** The queries' scores, best z first. */
  readonly results: readonly QueryScore[];
  /** The four best vocabulary descriptions (quality and production left out): what else it could be. */
  readonly closest: readonly TermScore[];
  readonly peakDbfs: number;
  readonly nearSilent: boolean;
}

export interface MatchOptions {
  readonly alts?: readonly string[];
  readonly range?: ListenRange;
  readonly signal?: AbortSignal;
}

const cleanQueries = (queries: readonly string[]) =>
  queries.every((q) => typeof q === 'string' && q.trim() !== '');

export async function matchSound(
  models: ListenModels,
  source: ListenSource,
  queries: readonly string[],
  options: MatchOptions = {},
): AsyncResult<SoundMatch> {
  if (queries.length === 0 || !cleanQueries(queries) || !cleanQueries(options.alts ?? [])) {
    return err(
      ListenBadInput(undefined, { detail: 'no query given: pass one or more non-empty descriptions' }),
    );
  }
  const checked = checkRange(source, options.range);
  if (!checked.ok) return checked;
  const embedded = await models.clap.embedSource(source.samples, options.range, options.signal);
  if (!embedded.ok) return embedded;
  const texts = await models.text.queries([...queries, ...(options.alts ?? [])], options.signal);
  if (!texts.ok) return texts;
  const { vocab } = texts.value;
  const audio = embedded.value.pooled;
  const sound = calibrate(audio, vocab);
  const asked = texts.value.queries.slice(0, queries.length);
  const alts = texts.value.queries.slice(queries.length);
  const results = scoreQueries(audio, asked, vocab, alts, sound).sort((a, b) => b.z - a.z);
  const dbfs = peakDbfs(source, options.range);
  return ok({
    results,
    closest: topTerms(sound, vocab, 4, { exclude: LISTEN_CONFIG.calibration.skip }),
    peakDbfs: dbfs,
    nearSilent: isNearSilent(dbfs),
  });
}
