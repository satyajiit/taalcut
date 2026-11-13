// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-LANG: the Indian-language identifier. The piece policy and the labels are pure; the live run needs Anuvani-LID's
 * accelerator graphs in packages/audio/.cache/anuvani-lid (or TAALCUT_ANUVANI_LID_DIR) with the model's own FLEURS
 * samples (CC-BY-4.0) beside them, and says why it skips otherwise.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSpeechPcm, readPcmChunks } from '../../src/asset-audio/wav-file';
import { whisperCodeFor } from '../../src/speech/whisper-languages';
import {
  createIndicLid,
  INDIC_LID,
  laterPieces,
  INDIC_LID_LABELS,
  softmaxScores,
  voicePieces,
} from '../../src/speech/indic-lid';

describe('voicePieces', () => {
  const window = { startMs: 0, endMs: 30_000 };

  it('merges phrases a short pause apart and drops slivers', () => {
    const spans = [
      { startMs: 1000, endMs: 3000 },
      { startMs: 3400, endMs: 6000 },
      { startMs: 6100, endMs: 6250 },
      { startMs: 8000, endMs: 9000 },
    ];
    expect(voicePieces(spans, window)).toEqual([
      { startMs: 1000, endMs: 6000 },
      { startMs: 8000, endMs: 9000 },
    ]);
  });

  it('never makes a piece longer than 15 s, and a short tail becomes a full piece at the end', () => {
    expect(voicePieces([{ startMs: 0, endMs: 30_500 }], { startMs: 0, endMs: 30_500 })).toEqual([
      { startMs: 0, endMs: 15_000 },
      { startMs: 15_000, endMs: 30_000 },
      { startMs: 15_500, endMs: 30_500 },
    ]);
  });

  it('keeps to the window, and takes the window itself without phrases', () => {
    expect(voicePieces([{ startMs: 25_000, endMs: 40_000 }], window)).toEqual([
      { startMs: 25_000, endMs: 30_000 },
    ]);
    expect(voicePieces(undefined, { startMs: 1000, endMs: 4000 })).toEqual([{ startMs: 1000, endMs: 4000 }]);
  });
});

describe('laterPieces', () => {
  it('spreads a few pieces over the sound after the window, and none when there is none', () => {
    const stretches = [
      { startMs: 0, endMs: 9000 },
      { startMs: 20_000, endMs: 50_000 },
      { startMs: 70_000, endMs: 75_000 },
      { startMs: 90_000, endMs: 90_500 },
    ];
    const later = laterPieces(stretches, { startMs: 0, endMs: 10_000 }, 100_000, 3);
    expect(later).toEqual([
      { startMs: 20_000, endMs: 35_000 },
      { startMs: 35_000, endMs: 50_000 },
      { startMs: 70_000, endMs: 75_000 },
    ]);
    expect(laterPieces(stretches, { startMs: 0, endMs: 10_000 }, 100_000, 2)).toEqual([later[0], later[2]]);
    expect(laterPieces([{ startMs: 0, endMs: 9000 }], { startMs: 0, endMs: 10_000 }, 10_000, 3)).toEqual([]);
  });
});

describe('labels', () => {
  it('names 23 languages, Odia among them, most likely first', () => {
    expect(INDIC_LID_LABELS).toHaveLength(23);
    const logits = INDIC_LID_LABELS.map((label) => (label === 'or' ? 5 : 0));
    const [top] = softmaxScores(logits);
    expect(top?.language).toBe('or');
    expect(top?.probability).toBeGreaterThan(0.8);
  });

  it('includes eight languages Whisper can not write out', () => {
    expect(INDIC_LID_LABELS.filter((label) => !whisperCodeFor(label))).toEqual([
      'brx',
      'doi',
      'ks',
      'kok',
      'mai',
      'mni',
      'or',
      'sat',
    ]);
  });
});

const cache =
  process.env.TAALCUT_ANUVANI_LID_DIR ?? fileURLToPath(new URL('../../.cache/anuvani-lid', import.meta.url));
const live = existsSync(join(cache, INDIC_LID.encoder)) && existsSync(join(cache, 'sample-te_in.wav'));

async function samples(file: string): Promise<Float32Array> {
  const pcm = await readSpeechPcm(join(cache, file));
  if (!pcm.ok) throw new Error(pcm.error.code);
  const chunks: Float32Array[] = [];
  for await (const chunk of readPcmChunks(pcm.value, { startFrame: 0, endFrame: pcm.value.frames }, 16_000))
    chunks.push(chunk);
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

describe.skipIf(!live)('Anuvani-LID, live (packages/audio/.cache/anuvani-lid)', () => {
  it('names the FLEURS samples it ships with', async () => {
    const identifier = createIndicLid({ modelDir: cache });
    for (const [file, language] of [
      ['sample-te_in.wav', 'te'],
      ['sample-ta_in.wav', 'ta'],
      ['sample-bn_in.wav', 'bn'],
      ['sample-hi_in.wav', 'hi'],
    ] as const) {
      const heard = await identifier.identify(await samples(file));
      expect(heard.ok && heard.value[0]?.language, file).toBe(language);
    }
  }, 120_000);
});
