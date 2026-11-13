// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FluidAudio sidecar: cancel before the call, word times, one model load per helper, and the sherpa fallback. */
import { err, ok, type TaalcutError, type Transcript } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { PARAKEET_LOAD, type SpeechEngine, type SpeechSidecar } from '../../src/speech/engine';
import { createFluidAudioEngine } from '../../src/speech/fluid-engine';
import { rangeToMs } from '../../src/rates';

const hello: Transcript = {
  version: 1,
  language: 'en',
  segments: [],
  engine: 'whisper',
  model: 'whisper-small-q8_0',
  local: true,
  wordTiming: 'native',
};

function failure(code: string): TaalcutError {
  return { code, messageKey: `errors.${code}`, retryable: false, detail: 'weights missing' };
}

const hola = {
  text: 'hola',
  durationMs: 400,
  rtf: 0.02,
  words: [{ text: 'hola', startMs: 80, endMs: 360, confidence: 0.91 }],
};

/** The helper's ASR service: `asr.transcribe` says `asr.not_loaded` until an `asr.load` succeeds; `restart` forgets it. */
function fakeHelper(load: () => TaalcutError | undefined = () => undefined) {
  const seen: { method: string; params: unknown }[] = [];
  let loaded = false;
  const sidecar: SpeechSidecar = {
    request: async <T>(method: string, params: unknown) => {
      seen.push({ method, params });
      if (method === 'asr.load') {
        const failed = load();
        if (failed) return err(failed);
        loaded = true;
        return ok({ loadMs: 160 } as T);
      }
      return loaded ? ok(hola as T) : err(failure('asr.not_loaded'));
    },
  };
  return {
    sidecar,
    seen,
    restart() {
      loaded = false;
    },
  };
}

describe('createFluidAudioEngine', () => {
  it('does not call the sidecar when the signal is already aborted', async () => {
    let calls = 0;
    const sidecar: SpeechSidecar = {
      request: async <T>() => {
        calls += 1;
        return ok({} as T);
      },
    };
    const signal = AbortSignal.abort();
    const result = await createFluidAudioEngine(sidecar).transcribe('/tmp/clip.wav', { signal });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('core.cancelled');
  });

  it('maps word times onto the 1000/1 clock and passes the spoken base code', async () => {
    const { sidecar, seen } = fakeHelper();
    const result = await createFluidAudioEngine(sidecar).transcribe('/tmp/clip.wav', { language: 'pt-BR' });
    const transcribe = { method: 'asr.transcribe', params: { path: '/tmp/clip.wav', language: 'pt' } };
    expect(seen).toEqual([transcribe, { method: 'asr.load', params: PARAKEET_LOAD }, transcribe]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      engine: 'parakeet',
      language: 'pt-BR',
      local: true,
      wordTiming: 'native',
    });
    expect(rangeToMs(result.value.segments[0]!.words[0]!.range)).toEqual({ startMs: 80, endMs: 360 });
  });

  it('loads the model once per helper process, and again after the helper restarts', async () => {
    const helper = fakeHelper();
    const engine = createFluidAudioEngine(helper.sidecar);
    const loads = () => helper.seen.filter((call) => call.method === 'asr.load').length;
    expect((await engine.transcribe('/tmp/a.wav', { language: 'en' })).ok).toBe(true);
    expect((await engine.transcribe('/tmp/b.wav', { language: 'en' })).ok).toBe(true);
    expect(loads()).toBe(1);
    helper.restart();
    expect((await engine.transcribe('/tmp/c.wav', { language: 'en' })).ok).toBe(true);
    expect(loads()).toBe(2);
    expect(helper.seen.filter((call) => call.method === 'asr.transcribe')).toHaveLength(5);
  });

  it('logs accelerator_failed and delegates when the model will not load', async () => {
    const events: { operation: string; reason: string }[] = [];
    const fallback: SpeechEngine = {
      id: 'sherpa',
      languages: () => ['en'],
      transcribe: async () => ok(hello),
    };
    const { sidecar } = fakeHelper(() => failure('asr.model_load_failed'));
    const result = await createFluidAudioEngine(sidecar, {
      fallback,
      onFallback: (event) => events.push({ operation: event.operation, reason: event.reason }),
    }).transcribe('/tmp/clip.wav', { language: 'en' });
    expect(events).toEqual([{ operation: 'audio.transcribe', reason: 'accelerator_failed' }]);
    expect(result.ok && result.value.engine).toBe('whisper');
  });

  it('is unavailable when the model is missing and no fallback was given', async () => {
    const { sidecar } = fakeHelper(() => failure('asr.model_missing'));
    const result = await createFluidAudioEngine(sidecar).transcribe('/tmp/clip.wav');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('audio.engine_unavailable');
  });
});
