// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Routing table: per-slice ids, Hindi, unsure, tiers, cloud-first, and language id args. */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { AUDIO_CONFIG } from '../../src/config';
import { detectLanguage } from '../../src/speech/detect';
import { routeTranscription, type DetectedLanguages } from '../../src/speech/route';

function detected(tags: readonly string[], language: string | null = tags[0] ?? null): DetectedLanguages {
  return {
    language,
    probability: tags.length > 0 ? 0.9 : null,
    perSlice: tags.map((tag) => ({ language: tag, probability: 0.9 })),
  };
}

describe('routeTranscription', () => {
  it('sends en, es and pt, including a shared region tag, to Parakeet', () => {
    const english = routeTranscription(detected(['en', 'en']), {
      tier: 'high',
      cloudFirst: false,
      consent: false,
    });
    expect(english).toMatchObject({
      engine: 'parakeet',
      language: 'en',
      model: AUDIO_CONFIG.models.parakeet,
    });
    const brazil = routeTranscription(detected(['pt-BR', 'pt-BR']), {
      tier: 'recommended',
      cloudFirst: false,
      consent: true,
    });
    expect(brazil).toMatchObject({ engine: 'parakeet', language: 'pt-BR' });
    expect(brazil.cloudSkipped).toBeUndefined();
  });

  it('keeps the earliest base code when two Parakeet languages tie', () => {
    const mixed = routeTranscription(detected(['en', 'pt-BR'], 'en'), {
      tier: 'recommended',
      cloudFirst: false,
      consent: false,
    });
    expect(mixed).toMatchObject({ engine: 'parakeet', language: 'en' });
  });

  it('sends Hindi in any slice to whisper, with the tier model', () => {
    const high = routeTranscription(detected(['en', 'hi-IN']), {
      tier: 'high',
      cloudFirst: false,
      consent: true,
    });
    expect(high).toMatchObject({
      engine: 'whisper',
      language: 'hi',
      whisperLanguage: 'hi',
      whisperModel: 'medium',
      model: AUDIO_CONFIG.models.whisperMedium,
    });
    const minimum = routeTranscription(detected(['hi']), {
      tier: 'minimum',
      cloudFirst: false,
      consent: false,
    });
    expect(minimum).toMatchObject({
      whisperModel: 'small',
      model: AUDIO_CONFIG.models.whisperSmall,
    });
  });

  it('names one language Whisper knows to it, and uses auto when detection is empty (LIB1-LANG)', () => {
    const french = routeTranscription(detected(['fr'], 'fr'), {
      tier: 'recommended',
      cloudFirst: false,
      consent: false,
    });
    expect(french).toMatchObject({ engine: 'whisper', language: 'fr', whisperLanguage: 'fr' });
    const bengali = routeTranscription(detected(['bn'], 'bn'), {
      tier: 'recommended',
      cloudFirst: false,
      consent: false,
    });
    expect(bengali).toMatchObject({ engine: 'whisper', whisperLanguage: 'bn' });
    const empty = routeTranscription(detected([]), {
      tier: 'recommended',
      cloudFirst: false,
      consent: false,
    });
    expect(empty).toMatchObject({ engine: 'whisper', language: null, whisperLanguage: 'auto' });
  });

  it('keeps mixed speech out of any one language (LIB1-LANG)', () => {
    const hinglish = routeTranscription(detected(['hi', 'en'], null), {
      tier: 'recommended',
      cloudFirst: false,
      consent: false,
    });
    expect(hinglish).toMatchObject({ engine: 'whisper', language: null, whisperLanguage: 'auto' });
  });

  it('uses Scribe only when cloud-first has consent, and records a skip otherwise', () => {
    const input = detected(['en']);
    const cloud = routeTranscription(input, { tier: 'recommended', cloudFirst: true, consent: true });
    expect(cloud).toMatchObject({ engine: 'scribe', language: 'en', model: AUDIO_CONFIG.models.scribe });
    const skipped = routeTranscription(input, { tier: 'recommended', cloudFirst: true, consent: false });
    expect(skipped).toMatchObject({ engine: 'parakeet', cloudSkipped: 'no_consent' });
  });

  it('treats a one-slice user language as the detection result', () => {
    const user = routeTranscription(detected(['es'], 'es'), {
      tier: 'minimum',
      cloudFirst: false,
      consent: false,
    });
    expect(user).toMatchObject({ engine: 'parakeet', language: 'es' });
  });
});

describe('detectLanguage', () => {
  it('reads the auto-detected line from string paths and does not invent a cutoff', async () => {
    const argsSeen: string[][] = [];
    const result = await detectLanguage(['/tmp/a.wav', { path: '/tmp/b.wav' }], {
      binary: 'whisper-cli',
      model: 'ggml-tiny.bin',
      run: async (args) => {
        argsSeen.push([...args]);
        const path = args[args.length - 1] ?? '';
        const language = path.endsWith('b.wav') ? 'es' : 'en';
        return ok({
          stdout: '',
          stderr: `whisper: auto-detected language: ${language} (p = 0.42)\n`,
          exitCode: 0,
        });
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.perSlice).toEqual([
      { language: 'en', probability: 0.42 },
      { language: 'es', probability: 0.42 },
    ]);
    expect(result.value.language).toBe('en');
    expect(argsSeen[0]).toEqual([
      'whisper-cli',
      '-m',
      'ggml-tiny.bin',
      '-dl',
      '-d',
      '10000',
      '-f',
      '/tmp/a.wav',
    ]);
  });

  it('returns an empty detection for no slices', async () => {
    const result = await detectLanguage([], { binary: 'whisper-cli', model: 'tiny' });
    expect(result.ok && result.value).toEqual({ language: null, probability: null, perSlice: [] });
  });
});
