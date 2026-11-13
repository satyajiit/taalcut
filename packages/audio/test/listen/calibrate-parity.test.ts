// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5 from upstream's own embeddings (no models): the calibration against earshot's on every parity clip. z
 * within ±0.05 of upstream's for all 52 clips × 322 terms with identical verdicts, the queries' cos/u/z, and every
 * `earshot match` run (z, verdict, `p_vs_alts` within ±0.01) re-scored from the same vectors.
 */
import { describe, expect, it } from 'vitest';
import { blob, blobRows, cli, intermediate, manifest } from '../../../../tools/earshot-parity/fixtures.mjs';
import { scoreQueries, type EmbeddedText } from '../../src/listen/calibrate/match';
import { calibrate, calibrateQuery } from '../../src/listen/calibrate/score';
import { verdictFor, verdictOf } from '../../src/listen/calibrate/verdict';
import { createVocab, vocabTerms } from '../../src/listen/calibrate/vocab';

const vocab = createVocab(blobRows('clap-text/vocab'));
const text = intermediate<{
  vocab: { terms: string[]; bias: number[] };
  queries: { texts: string[]; nearestCategory: string[]; bias: number[] };
}>('text');
const queryRows = blobRows('clap-text/queries');
const UPSTREAM_VERDICT: Record<string, string> = { 'no match': 'no_match' };

/** Any phrase upstream embedded through the templates: a query, or a vocabulary term. */
function embedded(phrase: string): EmbeddedText {
  const q = text.queries.texts.indexOf(phrase);
  const t = vocab.terms.indexOf(phrase);
  const row = q >= 0 ? queryRows[q] : vocab.rows[t];
  if (!row) throw new Error(`no upstream embedding for ${phrase}`);
  return { text: phrase, embedding: row };
}

describe('calibration from upstream embeddings', () => {
  it('the vocabulary and its bias are upstream’s', () => {
    expect(vocabTerms().terms).toEqual(text.vocab.terms);
    vocab.bias.forEach((b, i) => expect(b).toBeCloseTo(text.vocab.bias[i] ?? Number.NaN, 5));
  });

  it('z within ±0.05 and identical verdicts: every clip × 322 terms', () => {
    let worst = 0;
    let compared = 0;
    let differ = 0;
    for (const clip of manifest().clips) {
      const sound = calibrate(blob(`clap-audio/${clip.id}`).data, vocab);
      const theirs = blob(`calib-z-vocab/${clip.id}`).data;
      sound.z.forEach((z, t) => {
        const category = vocab.categories[t] ?? 'everyday';
        const up = theirs[t] ?? Number.NaN;
        worst = Math.max(worst, Math.abs(z - up));
        const ours = verdictFor(z, category);
        if (ours === null) return;
        compared += 1;
        if (ours !== verdictOf(up)) differ += 1;
      });
    }
    console.warn(
      `calibration: max |Δz| ${worst.toExponential(2)}; ${differ} of ${compared} validated verdicts differ`,
    );
    expect(worst).toBeLessThan(0.05);
    expect(differ).toBe(0);
  });

  it('the full term arrays (cos, u, z) on the clips upstream kept them for', () => {
    for (const id of Object.keys(intermediate<Record<string, unknown>>('clap-audio'))) {
      let full;
      try {
        full = blobRows(`calib-vocab-full/${id}`);
      } catch {
        continue;
      }
      const sound = calibrate(blob(`clap-audio/${id}`).data, vocab);
      [sound.cos, sound.u, sound.z].forEach((ours, row) =>
        ours.forEach((v, t) => expect(Math.abs(v - (full[row]?.[t] ?? Number.NaN))).toBeLessThan(1e-4)),
      );
    }
  });

  it('the 49 queries: cos, u and z within 1e-4, the same nearest category', () => {
    queryRows.forEach((row, j) => {
      expect(vocab.biasOf(row)).toBeCloseTo(text.queries.bias[j] ?? Number.NaN, 5);
      expect(vocab.nearestCategory(row)).toBe(text.queries.nearestCategory[j]);
    });
    for (const clip of manifest().clips) {
      const audio = blob(`clap-audio/${clip.id}`).data;
      const sound = calibrate(audio, vocab);
      const theirs = blobRows(`calib-query/${clip.id}`);
      queryRows.forEach((q, j) => {
        const ours = calibrateQuery(sound, audio, q, vocab.biasOf(q));
        expect(Math.abs(ours.cosine - (theirs[0]?.[j] ?? Number.NaN))).toBeLessThan(1e-4);
        expect(Math.abs(ours.u - (theirs[1]?.[j] ?? Number.NaN))).toBeLessThan(1e-4);
        expect(Math.abs(ours.z - (theirs[2]?.[j] ?? Number.NaN))).toBeLessThan(1e-3);
      });
    }
  });

  it('every `earshot match` run: z, verdict and p_vs_alts (±0.01) as upstream reported them', () => {
    let runs = 0;
    let worstP = 0;
    for (const [id, run] of Object.entries(cli<{ results: Record<string, unknown>[] }>('match'))) {
      const args = run.argv.slice(2);
      if (args.includes('--start') || run.exit !== 0) continue;
      const alt = args.indexOf('--alts');
      const queries = (alt >= 0 ? args.slice(0, alt) : args).map(embedded);
      const alts = alt >= 0 ? args.slice(alt + 1).map(embedded) : [];
      const clipId = (run.argv[1] ?? '').replace(/\.wav$/, '');
      const audio = blob(`clap-audio/${clipId}`).data;
      const ours = scoreQueries(audio, queries, vocab, alts);
      for (const theirs of run.result.results) {
        const row = ours.find((r) => r.query === theirs.query);
        expect(row, `${id}: ${String(theirs.query)}`).toBeDefined();
        if (!row) continue;
        expect(row.z, id).toBeCloseTo(Number(theirs.z), 2);
        expect(row.cosine, id).toBeCloseTo(Number(theirs.cosine), 3);
        expect(row.hint, id).toBe(!theirs.validated);
        const verdict = UPSTREAM_VERDICT[String(theirs.verdict)] ?? theirs.verdict;
        expect(row.verdict, id).toBe(row.hint ? null : verdict);
        if (theirs.p_vs_alts === null) expect(row.pVsAlts).toBeNull();
        else worstP = Math.max(worstP, Math.abs((row.pVsAlts ?? Number.NaN) - Number(theirs.p_vs_alts)));
      }
      runs += 1;
    }
    console.warn(`match: ${runs} runs re-scored, max |Δp_vs_alts| ${worstP.toFixed(4)}`);
    expect(runs).toBeGreaterThan(40);
    expect(worstP).toBeLessThanOrEqual(0.01);
  });
});
