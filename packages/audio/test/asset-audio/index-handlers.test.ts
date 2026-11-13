// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing kinds over the asset audio store (IX-A1, A2, A4), with a fake FFmpeg pass, a fake VAD, a fake
 * whisper decoder and a fake Parakeet helper: one decode serves both stages, nobody speaking skips whisper, and
 * the PCM is gone once the asset's speech stages are done or have failed.
 */
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectJobRunner, err, ok, type AsyncResult } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  audioIdentifyLanguageJob,
  audioTranscribeAssetParakeetJob,
  audioTranscribeAssetWhisperJob,
  createAssetAudioStore,
  createAudioIndexJobs,
  type AssetAudioStore,
  type AudioIndexJobDeps,
  type WhisperDecoder,
} from '../../src';
import type { VadEngine } from '../../src/cleanup/vad';
import { LanguageDetectFailed } from '../../src/errors';
import type { SpeechSidecar } from '../../src/speech/engine';
import { audioPlan, fakePassFfmpeg } from '../helpers/audio-pass';
import { loudnessVad } from '../helpers/fake-vad';

interface DecoderCall {
  readonly kind: 'identify' | 'transcribe';
  readonly audio: string;
  readonly model: string;
  readonly language?: string;
  readonly bytes: number;
}

let dir = '';
let store: AssetAudioStore;
let models: { tiny: string; small: string };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-index-handlers-'));
  store = createAssetAudioStore({ parent: join(dir, 'store') });
  models = { tiny: join(dir, 'ggml-tiny.bin'), small: join(dir, 'ggml-small-q8_0.bin') };
  await Promise.all([writeFile(models.tiny, 'tiny'), writeFile(models.small, 'small')]);
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function fakeDecoder(identify?: () => AsyncResult<{ language: string; probability: number }>) {
  const calls: DecoderCall[] = [];
  const decoder: WhisperDecoder = {
    mode: 'persistent',
    async identifyLanguage(request) {
      calls.push({
        kind: 'identify',
        audio: request.audio,
        model: request.model,
        bytes: (await stat(request.audio)).size,
      });
      return identify ? identify() : ok({ language: 'es', probability: 0.8 });
    },
    async transcribe(request) {
      const bytes = (await stat(request.audio)).size;
      calls.push({
        kind: 'transcribe',
        audio: request.audio,
        model: request.model,
        language: request.language,
        bytes,
      });
      const language = request.language === 'auto' ? 'es' : request.language;
      return ok({ language, tokens: [{ text: ' Hola', fromMs: 100, toMs: 400, probability: 0.9 }] });
    },
  };
  return { decoder, calls };
}

const deafVad: VadEngine = {
  probabilities: async () => ok({ probabilities: new Float32Array(0), windowMs: 32, backend: 'cpu' }),
  stream: () => ({ push: async (samples) => ok(new Float32Array(Math.floor(samples.length / 512))) }),
};

function deps(extra: Partial<AudioIndexJobDeps> = {}): AudioIndexJobDeps & { readonly logs: string[] } {
  const logs: string[] = [];
  return {
    store,
    media: fakePassFfmpeg({ frames: 32_000 }).ctx,
    settings: { hasSpeechUploadConsent: () => false, localOnly: () => true, tier: () => 'minimum' },
    whisper: { binary: '', tiny: models.tiny, small: models.small, medium: '' },
    beats: { onnx: { openSession: async () => err(LanguageDetectFailed()) }, modelDir: '' },
    log: (message) => logs.push(message),
    logs,
    ...extra,
  };
}

const asset = { path: '/clips/talk.mov', contentHash: 'c'.repeat(64), plan: audioPlan(2000) };

describe('audio indexing handlers', () => {
  it('decodes once for language ID and the transcript, and removes the PCM when the transcript is done', async () => {
    const { decoder, calls } = fakeDecoder();
    const runner = createDirectJobRunner(createAudioIndexJobs(deps({ decoder, vad: loudnessVad() })));
    const identified = await runner.run(audioIdentifyLanguageJob, asset);
    if (!identified.ok) throw new Error(identified.error.code);
    expect(identified.value).toMatchObject({
      silent: false,
      measure: { integratedLufs: -21.4, nonSilentMs: 1250, durationMs: 2000 },
      detected: { language: 'es', probability: 0.8, perSlice: [{ language: 'es', probability: 0.8 }] },
      speech: { detector: 'silero', complete: true },
    });
    const [identify] = calls;
    expect(identify).toMatchObject({ kind: 'identify', model: models.tiny });
    // Whisper hears the window's samples (here the whole 2 s: both bits of voice fit one), then they go.
    const window = identified.value.speech?.window;
    expect(window).toEqual({ startMs: 0, endMs: 2000 });
    if (!identify || !window) throw new Error('language ID did not run');
    expect(identify.bytes).toBe(44 + 32 * (window.endMs - window.startMs));
    expect(await exists(identify.audio)).toBe(false);
    expect(store.stats()).toMatchObject({ passes: 1, entries: 1 });

    const { detected } = identified.value;
    const transcript = await runner.run(audioTranscribeAssetWhisperJob, { ...asset, ...detected });
    if (!transcript.ok) throw new Error(transcript.error.code);
    expect(transcript.value).toMatchObject({ engine: 'whisper', language: 'es' });
    expect(calls[1]).toMatchObject({
      kind: 'transcribe',
      model: models.small,
      language: 'es',
      bytes: 44 + 64_000,
    });
    expect(store.stats()).toMatchObject({ passes: 1, reused: 1, entries: 0 });
    expect(await exists(calls[1]?.audio ?? '')).toBe(false);
  });

  it('calls an asset nobody speaks in silent, without asking whisper, and keeps nothing', async () => {
    const { decoder, calls } = fakeDecoder();
    const runner = createDirectJobRunner(createAudioIndexJobs(deps({ decoder, vad: deafVad })));
    const identified = await runner.run(audioIdentifyLanguageJob, asset);
    expect(identified).toMatchObject({
      ok: true,
      value: {
        silent: true,
        detected: { language: null, perSlice: [] },
        speech: { speechMs: 0, window: null },
      },
    });
    expect(calls).toEqual([]);
    expect(store.stats().entries).toBe(0);
  });

  it('listens to the non-silent audio when Silero is not installed, and says so', async () => {
    const { decoder, calls } = fakeDecoder();
    const jobDeps = deps({ decoder });
    const identified = await createDirectJobRunner(createAudioIndexJobs(jobDeps)).run(
      audioIdentifyLanguageJob,
      asset,
    );
    expect(identified).toMatchObject({
      ok: true,
      value: { silent: false, speech: { detector: 'stretches', speechMs: 1250, scannedMs: 0 } },
    });
    expect(calls.map((call) => call.kind)).toEqual(['identify']);
    expect(jobDeps.logs.join('\n')).toContain('silero-vad is not installed');
  });

  it('keeps the PCM without whisper when the user named the language, then transcribes in it', async () => {
    const { decoder, calls } = fakeDecoder();
    const runner = createDirectJobRunner(createAudioIndexJobs(deps({ decoder, vad: loudnessVad() })));
    const identified = await runner.run(audioIdentifyLanguageJob, { ...asset, language: 'hi' });
    if (!identified.ok) throw new Error(identified.error.code);
    expect(identified.value.detected).toEqual({
      language: 'hi',
      probability: 1,
      perSlice: [{ language: 'hi', probability: 1 }],
    });
    expect(calls).toEqual([]);
    expect(store.stats().entries).toBe(1);
    const transcript = await runner.run(audioTranscribeAssetWhisperJob, {
      ...asset,
      ...identified.value.detected,
    });
    expect(transcript.ok).toBe(true);
    expect(calls).toMatchObject([{ kind: 'transcribe', language: 'hi' }]);
    expect(store.stats()).toMatchObject({ passes: 1, entries: 0 });
  });

  it('removes the PCM when language ID fails', async () => {
    const { decoder } = fakeDecoder(async () =>
      err(LanguageDetectFailed(undefined, { detail: 'whisper said no' })),
    );
    const runner = createDirectJobRunner(createAudioIndexJobs(deps({ decoder, vad: loudnessVad() })));
    const identified = await runner.run(audioIdentifyLanguageJob, asset);
    expect(!identified.ok && identified.error.code).toBe(LanguageDetectFailed.code);
    expect(store.stats().entries).toBe(0);
  });

  it("sends Parakeet's languages to the helper with the PCM, and to whisper when its model won't load", async () => {
    const requests: { method: string; params: unknown }[] = [];
    let loads = true;
    let loaded = false;
    const sidecar: SpeechSidecar = {
      async request<T>(method: string, params: unknown) {
        requests.push({ method, params });
        if (method === 'asr.load') {
          loaded = loads;
          return loads
            ? ok({ loadMs: 1 } as T)
            : err({ code: 'asr.model_missing', messageKey: 'x', retryable: false, detail: 'no weights' });
        }
        if (!loaded) return err({ code: 'asr.not_loaded', messageKey: 'x', retryable: false });
        const words = [{ text: 'Hola', startMs: 100, endMs: 400, confidence: 0.9 }];
        return ok({ text: 'Hola', durationMs: 2000, rtf: 0.01, words } as T);
      },
    };
    const { decoder, calls } = fakeDecoder();
    const jobDeps = deps({ decoder, sidecar });
    const runner = createDirectJobRunner(createAudioIndexJobs(jobDeps));
    const input = { ...asset, perSlice: [{ language: 'es', probability: 0.8 }], language: 'es' };

    const parakeet = await runner.run(audioTranscribeAssetParakeetJob, input);
    expect(parakeet).toMatchObject({ ok: true, value: { engine: 'parakeet', language: 'es' } });
    const transcribe = requests.find((request) => request.method === 'asr.transcribe');
    expect(transcribe?.params).toMatchObject({ language: 'es', path: expect.stringContaining(store.root) });
    expect(calls).toEqual([]);

    // The helper restarted (idle exit) and its weights are gone: whisper transcribes.
    loads = false;
    loaded = false;
    const whisper = await runner.run(audioTranscribeAssetParakeetJob, input);
    expect(whisper).toMatchObject({ ok: true, value: { engine: 'whisper', language: 'es' } });
    expect(jobDeps.logs.join('\n')).toContain('parakeet unavailable');
    expect(store.stats()).toMatchObject({ passes: 2, entries: 0 });
  });
});
