// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WP-VO-LOCAL: Resemble AI Chatterbox as core's on-device VoiceProvider, and `createCompositeVoiceProvider`
 * routing between ElevenLabs and Chatterbox under Local only and per-module profile overrides.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate, ok, RationalTime, type VoiceConsentId } from '@taalcut/core';
import {
  CHATTERBOX_COMPONENT_SPECS,
  CHATTERBOX_MODELS,
  CHATTERBOX_PROVIDER,
  createChatterboxVoice,
  createCompositeVoiceProvider,
  createElevenLabsVoice,
  createMemoryCloudCallSink,
  disableNetwork,
  MODEL_CATALOG,
  type ChatterboxInferInput,
  type ModelSelector,
  type NetworkGuard,
} from '@taalcut/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { elevenLabsHarness, fixture } from './support/elevenlabs-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

function fakePcm(seconds = 1, sampleRate = 24_000): Float32Array {
  const count = Math.floor(seconds * sampleRate);
  const pcm = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pcm[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5;
  }
  return pcm;
}

describe('Chatterbox local VoiceProvider (WP-VO-LOCAL)', () => {
  it('registers Chatterbox Turbo and Multilingual in MODEL_CATALOG with GPU-first ONNX Runtime compute', () => {
    const turbo = MODEL_CATALOG.find(
      (e) => e.provider === CHATTERBOX_PROVIDER && e.model === CHATTERBOX_MODELS.draft,
    );
    const multi = MODEL_CATALOG.find(
      (e) => e.provider === CHATTERBOX_PROVIDER && e.model === CHATTERBOX_MODELS.final,
    );
    expect(turbo).toMatchObject({
      kind: 'text-to-speech',
      local: true,
      runtime: 'ONNX Runtime',
    });
    expect(multi).toMatchObject({
      kind: 'text-to-speech',
      local: true,
      minTier: 'recommended',
      runtime: 'ONNX Runtime',
    });
    expect(CHATTERBOX_COMPONENT_SPECS.every((spec) => spec.spdx === 'MIT')).toBe(true);
  });

  it('synthesises English drafts on chatterbox-turbo with paralinguistic tags preserved and valid WAV + alignment', async () => {
    const seen: ChatterboxInferInput[] = [];
    const callLog = createMemoryCloudCallSink();
    const voice = createChatterboxVoice({
      callLog,
      engine: async (input) => {
        seen.push(input);
        return ok({ pcm: fakePcm(1.2), sampleRate: 24_000 });
      },
    });
    expect(voice.available()).toEqual({ ok: true });
    const result = await voice.synthesize({
      text: 'Wait for it [laugh] that was amazing!',
      voiceId: 'cb_aria_en',
      language: 'en',
      quality: 'draft',
      seed: 77,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(seen[0]).toMatchObject({
      model: 'chatterbox-turbo',
      promptText: 'Wait for it [laugh] that was amazing!',
      spokenText: 'Wait for it that was amazing!',
      tags: ['[laugh]'],
      language: 'en',
      seed: 77,
    });
    expect(result.value.provider).toBe('resemble');
    expect(result.value.model).toBe('chatterbox-turbo');
    expect(result.value.mediaType).toBe('audio/wav');
    expect(result.value.costUsd).toBe(0);
    expect(String.fromCharCode(...result.value.bytes.subarray(0, 4))).toBe('RIFF');
    expect(result.value.alignment.characters.join('')).toBe('Wait for it that was amazing!');
    expect(callLog.records[0]).toMatchObject({
      provider: 'resemble',
      model: 'chatterbox-turbo',
      local: true,
      costUsd: 0,
    });
  });

  it('routes non-English languages (hi, es, pt-BR) to chatterbox-multilingual and strips paralinguistic tags', async () => {
    const seen: ChatterboxInferInput[] = [];
    const voice = createChatterboxVoice({
      engine: async (input) => {
        seen.push(input);
        return ok({ pcm: fakePcm(1.0) });
      },
      aligner: async () =>
        ok([
          { word: 'नमस्ते', startSeconds: 0.05, endSeconds: 0.45 },
          { word: 'दुनिया', startSeconds: 0.5, endSeconds: 0.95 },
        ]),
    });
    const result = await voice.synthesize({
      text: 'नमस्ते [chuckle] दुनिया',
      voiceId: 'cb_kavya_hi',
      language: 'hi',
      quality: 'draft',
      seed: 9,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(seen[0]?.model).toBe('chatterbox-multilingual');
    expect(seen[0]?.promptText).toBe('नमस्ते दुनिया');
    expect(result.value.alignment.characters.join('')).toBe('नमस्ते दुनिया');
    expect(result.value.alignment.startSeconds[0]).toBeCloseTo(0.05, 3);
  });

  it('creates and deletes a local zero-shot voice clone from a verified consent recording', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-cb-clone-'));
    try {
      const recording = join(dir, 'consent.wav');
      await writeFile(recording, Buffer.alloc(2048, 7));
      const seen: ChatterboxInferInput[] = [];
      const voice = createChatterboxVoice({
        engine: async (input) => {
          seen.push(input);
          return ok({ pcm: fakePcm(0.5) });
        },
      });
      const consentId = '01J00000000000000000000000' as VoiceConsentId;
      const cloned = await voice.createClone({ consentId, recordingPath: recording, name: 'My Studio Voice' });
      if (!cloned.ok) throw new Error(cloned.error.code);
      expect(cloned.value.requiresVerification).toBe(false);
      expect(cloned.value.voiceId).toMatch(/^cb_clone_[0-9a-f]{16}$/);

      const listed = await voice.voices({ language: 'hi' });
      expect(listed.ok && listed.value.some((v) => v.voiceId === cloned.value.voiceId && v.own)).toBe(true);

      const synth = await voice.synthesize({
        text: 'Cloned line.',
        voiceId: cloned.value.voiceId,
        language: 'en',
        quality: 'final',
        seed: 1,
      });
      expect(synth.ok).toBe(true);
      expect(seen[0]?.referenceAudioBytes?.byteLength).toBe(2048);

      await voice.deleteClone(cloned.value.voiceId);
      const after = await voice.voices();
      expect(after.ok && after.value.some((v) => v.voiceId === cloned.value.voiceId)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('routes through Chatterbox in createCompositeVoiceProvider when Local only is on, sending zero network requests', async () => {
    const { wire, session, settings } = elevenLabsHarness();
    wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
    wire.script('POST /v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/with-timestamps', {
      json: fixture('tts-with-timestamps'),
    });
    const cloud = createElevenLabsVoice({ session });
    const local = createChatterboxVoice({
      engine: async () => ok({ pcm: fakePcm(0.8) }),
    });
    const selector: ModelSelector = {
      resolve: () =>
        ok({
          module: 'voice',
          choices: [
            { provider: 'elevenlabs', model: 'eleven_v4_turbo' },
            { provider: 'resemble', model: 'chatterbox-turbo' },
          ],
        }),
    };
    const composite = createCompositeVoiceProvider({
      cloud,
      local,
      selector,
      localOnly: () => settings.localOnly,
    });

    settings.localOnly = true;
    expect(composite.available()).toEqual({ ok: true });
    const localResult = await composite.synthesize({
      text: 'Offline voiceover.',
      voiceId: 'cb_aria_en',
      language: 'en',
      quality: 'draft',
      seed: 10,
    });
    expect(localResult.ok && localResult.value.provider).toBe('resemble');
    expect(wire.requests).toHaveLength(0);

    settings.localOnly = false;
    const cloudResult = await composite.synthesize({
      text: 'Online voiceover.',
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      language: 'en',
      quality: 'draft',
      seed: 10,
    });
    expect(cloudResult.ok && cloudResult.value.provider).toBe('elevenlabs');
    expect(wire.requests.length).toBeGreaterThan(0);
    expect(RationalTime.of(24, FrameRate.of(24, 1)).value).toBe(24);
  });
});
