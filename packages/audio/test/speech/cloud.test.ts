// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Cloud speech: no consent skips the port; consent transcribes. */
import { ok, type CloudSpeechToText, type Transcript } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createCloudSpeechEngine, transcribeCloud, type SpeechSettings } from '../../src/speech/cloud-engine';
import { msRange } from '../../src/rates';

const hello: Transcript = {
  version: 1,
  language: 'en',
  segments: [
    {
      text: 'hello',
      range: msRange(0, 200),
      language: 'en',
      words: [{ text: 'hello', range: msRange(0, 200), confidence: 0.9 }],
    },
  ],
  engine: 'scribe',
  model: 'scribe_v2',
  local: false,
  wordTiming: 'native',
};

function settings(consent: boolean, localOnly = false): SpeechSettings {
  return {
    hasSpeechUploadConsent: () => consent,
    localOnly: () => localOnly,
    tier: () => 'recommended',
  };
}

function cloud(calls: unknown[]): CloudSpeechToText {
  return {
    cloudFirst: () => true,
    providers: () => ['elevenlabs'],
    estimate: () => ({ usd: 0.01, provider: 'elevenlabs', model: 'scribe_v2' }),
    transcribe: async (request) => {
      calls.push(request);
      return ok(hello);
    },
  };
}

describe('transcribeCloud', () => {
  it('does not call the port without consent or in local-only mode', async () => {
    const calls: unknown[] = [];
    const denied = await transcribeCloud('/tmp/clip.wav', { cloud: cloud(calls), settings: settings(false) });
    const local = await transcribeCloud('/tmp/clip.wav', {
      cloud: cloud(calls),
      settings: settings(true, true),
    });
    expect(denied.ok && denied.value).toEqual({ skipped: 'no_consent' });
    expect(local.ok && local.value).toEqual({ skipped: 'no_consent' });
    expect(calls).toEqual([]);
  });

  it('uploads when consent is granted and defaults a missing duration', async () => {
    const calls: { path?: string; durationMs?: number; language?: string }[] = [];
    const result = await transcribeCloud('/tmp/clip.wav', {
      cloud: cloud(calls),
      settings: settings(true),
      language: 'en',
    });
    expect(result.ok && result.value).toMatchObject({ engine: 'scribe', local: false });
    expect(calls).toEqual([{ path: '/tmp/clip.wav', durationMs: 0, language: 'en' }]);
  });

  it('createCloudSpeechEngine calls the port when consent exists', async () => {
    const calls: unknown[] = [];
    const engine = createCloudSpeechEngine({ cloud: cloud(calls), settings: settings(true) });
    expect(engine.estimate(1000)).toMatchObject({ model: 'scribe_v2' });
    const result = await engine.transcribe('/tmp/clip.wav', { language: 'hi' });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const blocked = await createCloudSpeechEngine({
      cloud: cloud(calls),
      settings: settings(false),
    }).transcribe('/tmp/clip.wav');
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.detail).toBe('no_consent');
    expect(calls).toHaveLength(1);
  });
});
