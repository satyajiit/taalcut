// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-LANG: `audio.identifyLanguage` with the Indian-language identifier (a fake), over the real audio store with a
 * fake FFmpeg pass and VAD: it hears the same voice whisper did, decides with the person's languages, says unclear
 * instead of guessing, and the transcript stage skips a language no engine writes out.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectJobRunner, err, ok, type AssetIndexView, type AsyncResult } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIO_SKIP,
  audioIdentifyLanguageJob,
  createAssetAudioStore,
  createAudioIndexJobs,
  createAudioIndexStages,
  INDIC_LID_LABELS,
  softmaxScores,
  type AssetAudioStore,
  type AudioIndexJobDeps,
  type IndicLid,
  type WhisperDecoder,
} from '../../src';
import { LanguageDetectFailed } from '../../src/errors';
import type { WhisperLanguageGuess } from '../../src/whisper/decoder';
import { audioPlan, fakePassFfmpeg } from '../helpers/audio-pass';
import { loudnessVad } from '../helpers/fake-vad';

let dir = '';
let store: AssetAudioStore;
let tiny = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-identify-cascade-'));
  store = createAssetAudioStore({ parent: join(dir, 'store') });
  tiny = join(dir, 'ggml-tiny.bin');
  await writeFile(tiny, 'tiny');
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

function whisperSays(guess: WhisperLanguageGuess): WhisperDecoder {
  return {
    mode: 'persistent',
    identifyLanguage: async () => ok(guess),
    transcribe: async () => err(LanguageDetectFailed()),
  };
}

/** An identifier that answers `logits` for every piece and counts the samples it heard. */
function identifier(logits: Partial<Record<(typeof INDIC_LID_LABELS)[number], number>>) {
  const heard: number[] = [];
  const lid: IndicLid = {
    identify: async (samples): AsyncResult<ReturnType<typeof softmaxScores>> => {
      heard.push(samples.length);
      return ok(softmaxScores(INDIC_LID_LABELS.map((label) => logits[label] ?? 0)));
    },
  };
  return { lid, heard };
}

function deps(extra: Partial<AudioIndexJobDeps>): AudioIndexJobDeps {
  return {
    store,
    media: fakePassFfmpeg({ frames: 32_000 }).ctx,
    settings: { hasSpeechUploadConsent: () => false, localOnly: () => true, tier: () => 'minimum' },
    whisper: { binary: '', tiny, small: '', medium: '' },
    beats: { onnx: { openSession: async () => err(LanguageDetectFailed()) }, modelDir: '' },
    vad: loudnessVad(),
    ...extra,
  };
}

const asset = { path: '/clips/talk.mov', contentHash: 'c'.repeat(64), plan: audioPlan(2000) };

describe('audio.identifyLanguage with the Indian-language identifier', () => {
  it('names Odia, which whisper can not, from the same voice whisper heard', async () => {
    const { lid, heard } = identifier({ or: 6, bn: 2 });
    const decoder = whisperSays({
      language: 'bn',
      probability: 0.41,
      distribution: [{ language: 'bn', probability: 0.41 }],
    });
    const runner = createDirectJobRunner(createAudioIndexJobs(deps({ decoder, indicLid: lid })));
    const identified = await runner.run(audioIdentifyLanguageJob, asset);
    if (!identified.ok) throw new Error(identified.error.code);
    expect(identified.value.detected).toMatchObject({ language: 'or', perSlice: [{ language: 'or' }] });
    expect(identified.value.decision).toMatchObject({
      state: 'detected',
      languages: ['or'],
      source: 'identifier',
    });
    expect(identified.value.whisper).toEqual([{ language: 'bn', probability: 0.41 }]);
    expect(identified.value.pieces?.[0]?.top[0]?.language).toBe('or');
    // The fake VAD hears two bits of voice more than a pause apart: one piece each, never the silence between.
    expect(heard).toHaveLength(2);
    expect(heard.reduce((sum, n) => sum + n, 0)).toBeLessThan(32_000);
    expect(identified.value.pieces).toHaveLength(2);
  });

  it('leaves the identifier out when whisper is sure of a language it can not name', async () => {
    const { lid, heard } = identifier({ hi: 3 });
    const decoder = whisperSays({ language: 'es', probability: 0.93 });
    const runner = createDirectJobRunner(createAudioIndexJobs(deps({ decoder, indicLid: lid })));
    const identified = await runner.run(audioIdentifyLanguageJob, asset);
    if (!identified.ok) throw new Error(identified.error.code);
    expect(identified.value.decision).toMatchObject({
      state: 'detected',
      languages: ['es'],
      source: 'whisper',
    });
    expect(heard).toEqual([]);
  });

  it('says unclear, naming nothing, when nobody is sure; the person’s languages lean but do not force it', async () => {
    const { lid } = identifier({ mai: 0.9, mr: 0.5, as: 0.2, or: 0.1 });
    const decoder = whisperSays({ language: 'ar', probability: 0.168 });
    const spokenLanguages = async () => ['or', 'hi', 'en'];
    const runner = createDirectJobRunner(
      createAudioIndexJobs(deps({ decoder, indicLid: lid, spokenLanguages })),
    );
    const identified = await runner.run(audioIdentifyLanguageJob, asset);
    if (!identified.ok) throw new Error(identified.error.code);
    expect(identified.value.detected).toEqual({
      language: null,
      probability: expect.any(Number),
      perSlice: [],
    });
    expect(identified.value.decision).toMatchObject({ state: 'unclear', languages: [] });
  });

  it('decides with whisper alone, and its floor, without the identifier', async () => {
    const decoder = whisperSays({ language: 'ar', probability: 0.168 });
    const runner = createDirectJobRunner(createAudioIndexJobs(deps({ decoder })));
    const identified = await runner.run(audioIdentifyLanguageJob, asset);
    if (!identified.ok) throw new Error(identified.error.code);
    expect(identified.value.decision).toMatchObject({ state: 'unclear', source: 'whisper' });
    expect(identified.value.pieces).toBeUndefined();
  });
});

describe('the speech stages and the decision', () => {
  const [language, transcript] = createAudioIndexStages();
  const view = (outputs: Record<string, unknown>, chosenLanguage?: string): AssetIndexView =>
    ({
      assetId: 'a',
      generation: 1,
      kind: 'video',
      path: '/clips/talk.mov',
      contentHash: 'c'.repeat(64),
      facts: { hasAudio: true },
      outputs,
      ...(chosenLanguage ? { chosenLanguage } : {}),
    }) as unknown as AssetIndexView;
  const identified = (languages: string[], state: 'detected' | 'unclear' | 'mixed' | 'chosen') => ({
    silent: false,
    measure: {
      integratedLufs: -20,
      loudnessRange: 3,
      truePeakDbtp: -1,
      nonSilentRatio: 1,
      nonSilentMs: 4000,
      durationMs: 4000,
    },
    detected: {
      language: state === 'unclear' ? null : (languages[0] ?? null),
      probability: 0.9,
      perSlice: languages.map((l) => ({ language: l, probability: 0.9 })),
    },
    decision: { state, languages, confidence: state === 'chosen' ? null : 0.9, source: 'identifier' },
  });

  it('obeys the language the person chose', () => {
    const job = language?.job(view({ 'media.normalise': undefined }, 'or'));
    expect(job && 'input' in job && job.input).toMatchObject({ language: 'or' });
  });

  it('files the clip under the decision, and an unclear clip under no language', () => {
    expect(language?.result(identified(['bn'], 'detected'), view({}))).toEqual(
      ok({ language: 'bn', spokenLanguage: { state: 'detected', languages: ['bn'], confidence: 0.9 } }),
    );
    // Odia: filed under it, and an older transcript made in another language goes.
    expect(language?.result(identified(['or'], 'detected'), view({}))).toEqual(
      ok({
        language: 'or',
        spokenLanguage: { state: 'detected', languages: ['or'], confidence: 0.9 },
        transcript: null,
      }),
    );
    expect(language?.result(identified([], 'unclear'), view({}))).toEqual(
      ok({ spokenLanguage: { state: 'unclear', languages: [], confidence: 0.9 } }),
    );
  });

  it('skips the transcript of Odia speech honestly, and sends mixed speech to whisper with no one language', () => {
    expect(transcript?.job(view({ 'audio.language': identified(['or'], 'detected') }))).toEqual({
      skip: AUDIO_SKIP.cannotTranscribe,
    });
    const mixed = transcript?.job(view({ 'audio.language': identified(['hi', 'en'], 'mixed') }));
    expect(mixed && 'input' in mixed && mixed.input).toMatchObject({ language: null });
    const bengali = transcript?.job(view({ 'audio.language': identified(['bn'], 'detected') }));
    expect(bengali && 'kind' in bengali && bengali.kind.kind).toBe('audio.transcribeAssetWhisper');
  });
});
