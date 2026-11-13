// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-B1's sound index: its z is earshot's calibrated z (the same as rank's, from precomputed per-sound statistics),
 * near-silent sounds rank last with `no_match`, hint queries get no verdict; and with the real text model a warm
 * free-text query over the SFX bank's 252 precomputed embeddings takes ≤ 300 ms.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ok } from '@taalcut/core';
import { calibrate, calibrateQuery } from '../../src/listen/calibrate/score';
import type { ListenText } from '../../src/listen/calibrate/text';
import { createVocab, vocabTerms } from '../../src/listen/calibrate/vocab';
import { createListenModels } from '../../src/listen/describe/context';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions } from '../../src/listen/models/sessions';
import { createSoundIndex, searchSoundIndex } from '../../src/listen/search/sound-index';
import { HAS_BANK, installedBank } from '../sfx-bank-helpers';
import { MODELS } from './models-helpers';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

function unitRows(count: number, seed: number): Float32Array[] {
  const rnd = seeded(seed);
  return Array.from({ length: count }, () => {
    const v = Float32Array.from({ length: 512 }, rnd);
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  });
}

const vocab = createVocab(unitRows(vocabTerms().terms.length, 7));

describe('the sound index', () => {
  const sounds = unitRows(30, 11).map((embedding, i) => ({
    id: `s${i}`,
    embedding,
    ...(i === 3 ? { nearSilent: true } : {}),
  }));
  const index = createSoundIndex(sounds);
  const [query] = unitRows(1, 99) as [Float32Array];

  it("gives rank's calibrated z for every sound", () => {
    const hits = index.score(query, vocab);
    for (const hit of hits) {
      const audio = sounds[hit.index]?.embedding ?? new Float32Array();
      const expected = calibrateQuery(calibrate(audio, vocab), audio, query, vocab.biasOf(query)).z;
      expect(hit.z).toBeCloseTo(expected, 2);
    }
  });

  it('ranks near-silent sounds last with no_match, the rest by z', () => {
    const hits = index.score(query, vocab);
    expect(hits.at(-1)?.id).toBe('s3');
    expect(hits.at(-1)?.verdict).toBe('no_match');
    const live = hits.slice(0, -1).map((h) => h.z);
    expect(live).toEqual([...live].sort((a, b) => b - a));
  });

  it('a hint query (nearest term in music_mood) gets no verdict', async () => {
    const mood = vocabTerms().categories.indexOf('music_mood');
    const text: ListenText = {
      embed: async () => ok({ rows: [], dtype: 'fp16', fromBank: true }),
      vocab: async () => ok(vocab),
      queries: async (texts) =>
        ok({ queries: texts.map((t) => ({ text: t, embedding: vocab.rows[mood] ?? query })), vocab }),
    };
    const found = await searchSoundIndex({ text }, index, 'a calm song', { top: 5 });
    expect(found.ok && found.value.hint).toBe(true);
    if (found.ok) for (const hit of found.value.hits) expect(hit.verdict).toBeNull();
  });

  it('filters entries and keeps the top', () => {
    const hits = index.score(query, vocab, { filter: (e) => Number(e.id.slice(1)) % 2 === 0 });
    expect(hits.every((h) => Number(h.id.slice(1)) % 2 === 0)).toBe(true);
  });
});

describe.skipIf(!MODELS || !HAS_BANK)('a warm query over the bank (fp16, real text model)', () => {
  const files = directoryListenFiles(MODELS ?? '', 'fp16');
  const sessions = createListenSessions({ files });
  const models = createListenModels(sessions, files);
  afterAll(() => sessions.release());

  it('takes ≤ 300 ms: one text embedding and the precomputed bank', async () => {
    const bank = await installedBank();
    const rows = await bank.embeddings('fp16');
    if (!rows.ok) throw new Error(rows.error.code);
    const index = createSoundIndex(
      bank.items.map((item, i) => ({
        id: item.id,
        embedding: rows.value.rows.subarray(i * 512, (i + 1) * 512),
      })),
    );
    expect(index.entries.length).toBeGreaterThanOrEqual(230);
    const warm = await searchSoundIndex(models, index, 'a soft rounded pop', { top: 5 });
    expect(warm.ok).toBe(true);
    const times: number[] = [];
    for (const query of [
      'a heavy wooden door slam',
      'a crisp camera shutter',
      'a bright notification ding',
    ]) {
      const t0 = performance.now();
      const found = await searchSoundIndex(models, index, query, { top: 5 });
      times.push(performance.now() - t0);
      expect(found.ok).toBe(true);
    }
    const worst = Math.max(...times);
    console.warn(
      `bank search over ${index.entries.length} sounds: ${times.map((t) => t.toFixed(0)).join(', ')} ms`,
    );
    expect(worst).toBeLessThanOrEqual(300);
  }, 300_000);
});
