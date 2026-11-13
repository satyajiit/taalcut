// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-parity's calibration (EAR1-F5), scored by @taalcut/audio's own functions against upstream earshot's numbers
 * in the parity fixtures (tools/earshot-parity):
 *
 * - from upstream's embeddings (no model): every clip's pooled CLAP vector calibrated against upstream's 322
 *   vocabulary rows, z and verdicts against upstream's (`calib-z-vocab`); every `earshot match` run re-scored from
 *   the same vectors, its verdicts and `p_vs_alts`;
 * - end to end (the models, one dtype): our CLAP audio on every clip, the tags against the fp16-built bank's
 *   vocabulary and upstream's 49 free-text queries through our text model, as the runtime scores them (D23).
 */
import {
  calibrate,
  createVocab,
  scoreQueries,
  verdictFor,
  verdictOf,
  type EmbeddedText,
  type ListenModels,
  type ListenVocab,
} from '@taalcut/audio';
import {
  blob,
  blobRows,
  cli,
  ffmpegMono,
  intermediate,
  loadClip,
  manifest,
} from '../../../earshot-parity/fixtures.mjs';
import type { ListenDtype } from '../listening/environment';
import type { MeasuredMetric } from '../listening/outcome';
import { maxOf, quantile, share } from './stats';

const UPSTREAM_VERDICT: Readonly<Record<string, string>> = { 'no match': 'no_match' };

interface UpstreamMatchRow {
  readonly query: string;
  readonly z: number;
  readonly validated: boolean;
  readonly verdict: string;
  readonly p_vs_alts: number | null;
}

interface TagTally {
  readonly deltas: number[];
  compared: number;
  same: number;
}

/** Each clip's z over the vocabulary against upstream's: |Δz| for every term, verdicts where the term has one. */
function tallyTags(tally: TagTally, z: ArrayLike<number>, vocab: ListenVocab, theirs: Float32Array): void {
  for (let t = 0; t < z.length; t++) {
    const ours = z[t] ?? Number.NaN;
    const up = theirs[t] ?? Number.NaN;
    tally.deltas.push(Math.abs(ours - up));
    const verdict = verdictFor(ours, vocab.categories[t] ?? 'everyday');
    if (verdict === null) continue;
    tally.compared += 1;
    if (verdict === verdictOf(up)) tally.same += 1;
  }
}

/** Upstream's `earshot match` runs, re-scored from its own query, term and audio vectors. */
function matchRuns(vocab: ListenVocab) {
  const texts = intermediate<{ queries: { texts: string[] } }>('text').queries.texts;
  const queryRows = blobRows('clap-text/queries');
  const embedded = (phrase: string): EmbeddedText => {
    const q = texts.indexOf(phrase);
    const row = q >= 0 ? queryRows[q] : vocab.rows[vocab.terms.indexOf(phrase)];
    if (!row) throw new Error(`listen-parity: no upstream embedding for "${phrase}"`);
    return { text: phrase, embedding: row };
  };
  let runs = 0;
  let rows = 0;
  let same = 0;
  const pDeltas: number[] = [];
  for (const run of Object.values(cli<{ results: UpstreamMatchRow[] }>('match'))) {
    const args = run.argv.slice(2);
    if (args.includes('--start') || run.exit !== 0) continue;
    const alt = args.indexOf('--alts');
    const queries = (alt >= 0 ? args.slice(0, alt) : args).map(embedded);
    const alts = alt >= 0 ? args.slice(alt + 1).map(embedded) : [];
    const clipId = (run.argv[1] ?? '').replace(/\.wav$/, '');
    const ours = scoreQueries(blob(`clap-audio/${clipId}`).data, queries, vocab, alts);
    runs += 1;
    for (const theirs of run.result.results) {
      rows += 1;
      const row = ours.find((r) => r.query === theirs.query);
      if (!row) continue;
      const verdict = theirs.validated ? (UPSTREAM_VERDICT[theirs.verdict] ?? theirs.verdict) : null;
      if (row.verdict === verdict && Math.abs(row.z - theirs.z) < 0.005) same += 1;
      if (theirs.p_vs_alts !== null) pDeltas.push(Math.abs((row.pVsAlts ?? Number.NaN) - theirs.p_vs_alts));
    }
  }
  return { runs, rows, same, pDeltas };
}

/** The calibration from upstream's embeddings: no model runs. */
export function calibrationFromUpstream(): MeasuredMetric[] {
  const vocab = createVocab(blobRows('clap-text/vocab'));
  const tally: TagTally = { deltas: [], compared: 0, same: 0 };
  const clips = manifest().clips;
  for (const clip of clips) {
    const sound = calibrate(blob(`clap-audio/${clip.id}`).data, vocab);
    tallyTags(tally, sound.z, vocab, blob(`calib-z-vocab/${clip.id}`).data);
  }
  const match = matchRuns(vocab);
  const part = 'calibration';
  return [
    {
      name: 'tagZMaxDelta',
      value: maxOf(tally.deltas),
      better: 'lower',
      part,
      over: `${clips.length} clips × ${vocab.terms.length} terms`,
    },
    {
      name: 'tagVerdictAgreement',
      value: share(tally.same, tally.compared),
      better: 'higher',
      part,
      over: `${tally.compared} verdicts`,
    },
    {
      name: 'matchVerdictAgreement',
      value: share(match.same, match.rows),
      better: 'higher',
      part,
      over: `${match.rows} queries in ${match.runs} match runs (the same z and verdict)`,
    },
    {
      name: 'pVsAltsMaxDelta',
      value: maxOf(match.pDeltas),
      better: 'lower',
      part,
      over: `${match.pDeltas.length} p_vs_alts`,
    },
  ];
}

/** End to end in one dtype: our CLAP audio and text models, calibrated as the runtime does. */
export async function calibrationEndToEnd(
  models: ListenModels,
  dtype: ListenDtype,
): Promise<MeasuredMetric[]> {
  const tags = await models.text.vocab();
  if (!tags.ok) throw new Error(`listen-parity: the tag vocabulary: ${tags.error.code}`);
  const texts = intermediate<{ queries: { texts: string[] } }>('text').queries.texts;
  const queries = await models.text.queries(texts);
  if (!queries.ok) throw new Error(`listen-parity: the free-text queries: ${queries.error.code}`);
  const tally: TagTally = { deltas: [], compared: 0, same: 0 };
  const queryDeltas: number[] = [];
  const clips = manifest().clips;
  for (const clip of clips) {
    const sound = await models.clap.embedSource(ffmpegMono(loadClip(clip.id)));
    if (!sound.ok) throw new Error(`listen-parity: CLAP on ${clip.id}: ${sound.error.code}`);
    const audio = sound.value.pooled;
    tallyTags(tally, calibrate(audio, tags.value).z, tags.value, blob(`calib-z-vocab/${clip.id}`).data);
    const upstream = blobRows(`calib-query/${clip.id}`)[2] ?? new Float32Array();
    scoreQueries(audio, queries.value.queries, queries.value.vocab).forEach((row, j) =>
      queryDeltas.push(Math.abs(row.z - (upstream[j] ?? Number.NaN))),
    );
  }
  // fp16 holds every query within its bar; int8's text encoder moves a few further, so its bar is the 99th percentile.
  const queryQuantile = dtype === 'fp16' ? 1 : 0.99;
  return [
    {
      name: `${dtype}TagZMaxDelta`,
      value: maxOf(tally.deltas),
      better: 'lower',
      part: dtype,
      over: `${clips.length} clips × ${tags.value.terms.length} terms, fp16-built tag bank`,
    },
    {
      name: `${dtype}TagVerdictAgreement`,
      value: share(tally.same, tally.compared),
      better: 'higher',
      part: dtype,
      over: `${tally.compared} verdicts`,
    },
    {
      name: `${dtype}QueryZDelta`,
      value: quantile(queryDeltas, queryQuantile),
      better: 'lower',
      part: dtype,
      over: `${queryDeltas.length} clip × query z, ${queryQuantile === 1 ? 'max' : 'p99'} Δz (z as reported, 2 decimals)`,
    },
  ];
}
