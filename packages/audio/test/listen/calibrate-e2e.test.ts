// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5 end to end (D23): our CLAP audio per dtype, calibrated, against upstream's fp32 z on every parity clip.
 * Each dtype runs where the machine fit sends it: fp16 on WebGPU (Metal), int8 on the CPU (the CPU build:
 * TAALCUT_FORCE_CPU, no Metal). Needs `TAALCUT_EAR1_MODELS`.
 *
 * - Vocabulary tags (× the 322 terms) are scored against the fp16-built bank on every machine, as the runtime does:
 *   fp16 z within ±0.15 and ≥ 95% of verdicts the same; int8 within ±0.3 and ≥ 90%; a differing verdict should mostly
 *   be flagged borderline.
 * - Free-text queries (× upstream's 49) are embedded by that dtype's text encoder and scored against that dtype's
 *   bank, as the runtime does: fp16 within ±0.15; int8 at the 99th percentile within ±0.3, its maximum reported (the
 *   int8 text encoder moves a few queries further, and an int8 query scores closer against the int8 vocabulary).
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { blob, blobRows, intermediate, manifest } from '../../../../tools/earshot-parity/fixtures.mjs';
import { calibrate, calibrateQuery } from '../../src/listen/calibrate/score';
import { decodeTextBank, textBankFiles, type TextBankIndex } from '../../src/listen/calibrate/text-bank';
import { isBorderline, verdictFor, verdictOf } from '../../src/listen/calibrate/verdict';
import { createVocab, vocabTerms, type ListenVocab } from '../../src/listen/calibrate/vocab';
import { createClapAudio } from '../../src/listen/models/clap-audio';
import { createClapText } from '../../src/listen/models/clap-text';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions, type ListenSessions } from '../../src/listen/models/sessions';
import { modelMono, MODELS } from './models-helpers';

const GATES = {
  fp16: { tags: 0.15, agree: 0.95, queries: 0.15, queryQuantile: 1 },
  int8: { tags: 0.3, agree: 0.9, queries: 0.3, queryQuantile: 0.99 },
} as const;
const DEVICES = { fp16: ['webgpu', 'cpu'], int8: ['cpu'] } as const;
const BANKS = new URL('../../../../tools/components/listen/text-embeddings/', import.meta.url);
const opened: ListenSessions[] = [];
afterAll(async () => {
  for (const sessions of opened) await sessions.release();
});

/** The committed bank's vocabulary for `dtype`, as the CLAP audio components ship it. */
function bankVocab(dtype: 'int8' | 'fp16'): ListenVocab {
  const files = textBankFiles(dtype);
  const index = JSON.parse(readFileSync(new URL(files.index, BANKS), 'utf8')) as TextBankIndex;
  const bank = decodeTextBank(index, new Uint8Array(readFileSync(new URL(files.data, BANKS))));
  if (!bank.ok) throw new Error(bank.error.detail);
  return createVocab(bank.value.lookup(vocabTerms().terms, vocabTerms().templates) ?? []);
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}

const stats = (d: number[]) =>
  `max ${Math.max(...d).toFixed(3)}, p99 ${quantile(d, 0.99).toFixed(3)}, median ${quantile(d, 0.5).toFixed(3)}`;

describe.skipIf(!MODELS).each(['fp16', 'int8'] as const)('%s end to end against upstream', (dtype) => {
  const gate = GATES[dtype];
  it(`tags within ±${gate.tags} (fp16 bank), ≥ ${gate.agree * 100}% of verdicts; queries within ±${gate.queries}`, async () => {
    const sessions = createListenSessions({
      files: directoryListenFiles(MODELS ?? '', dtype),
      plan: async () => ({ devices: [...DEVICES[dtype]] }),
    });
    opened.push(sessions);
    const tags = bankVocab('fp16');
    const own = bankVocab(dtype);
    const texts = intermediate<{ queries: { texts: string[] } }>('text').queries.texts;
    const embedded = await createClapText(sessions, 16).embedPhrases(texts, vocabTerms().templates);
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;
    const clap = createClapAudio(sessions);
    const tagDeltas: number[] = [];
    const queryDeltas: number[] = [];
    let compared = 0;
    let same = 0;
    let active = 0;
    let activeSame = 0;
    let flagged = 0;
    for (const clip of manifest().clips) {
      const sound = await clap.embedSource(modelMono(clip.id));
      expect(sound.ok).toBe(true);
      if (!sound.ok) continue;
      const audio = sound.value.pooled;
      const theirs = blob(`calib-z-vocab/${clip.id}`).data;
      calibrate(audio, tags).z.forEach((z, t) => {
        const up = theirs[t] ?? Number.NaN;
        tagDeltas.push(Math.abs(z - up));
        const verdict = verdictFor(z, tags.categories[t] ?? 'everyday');
        if (verdict === null) return;
        const upstream = verdictOf(up);
        compared += 1;
        if (verdict === upstream) same += 1;
        else if (isBorderline(z)) flagged += 1;
        if (verdict !== 'no_match' || upstream !== 'no_match') {
          active += 1;
          if (verdict === upstream) activeSame += 1;
        }
      });
      const scored = calibrate(audio, own);
      const upQueries = blobRows(`calib-query/${clip.id}`)[2] ?? [];
      embedded.value.forEach((q, j) => {
        const z = calibrateQuery(scored, audio, q, own.biasOf(q)).z;
        queryDeltas.push(Math.abs(z - (upQueries[j] ?? Number.NaN)));
      });
    }
    console.warn(
      `end to end ${dtype} (${sessions.backend('clapAudio')}): tags against the fp16 bank |Δz| ${stats(tagDeltas)}; ` +
        `verdicts ${same}/${compared} same (${((100 * same) / compared).toFixed(2)}%), ${activeSame}/${active} where ` +
        `either side has a match, ${flagged}/${compared - same} differing flagged borderline; free-text queries ` +
        `against the ${dtype} bank |Δz| ${stats(queryDeltas)}`,
    );
    expect(Math.max(...tagDeltas)).toBeLessThanOrEqual(gate.tags);
    expect(same / compared).toBeGreaterThanOrEqual(gate.agree);
    expect(quantile(queryDeltas, gate.queryQuantile)).toBeLessThanOrEqual(gate.queries);
  }, 600_000);
});
