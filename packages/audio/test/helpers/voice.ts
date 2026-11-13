// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A scripted VoiceProvider for audio's voice tests: each line becomes a WAV of tone bursts (one per word) with
 * character timings spread over them, as ElevenLabs' /with-timestamps returns them (seconds, per character). It
 * records every request, so tests see which quality, seed and context each line asked for.
 */
import { ok, type SynthesisRequest, type VoiceProvider } from '@taalcut/core';
import { encodeFloatWav } from '../../src/pcm/pcm';

export interface FakeVoiceOptions {
  /** Seconds per character of speech. */
  readonly perChar?: number;
  readonly leadSeconds?: number;
  readonly tailSeconds?: number;
  /** Final takes run this much longer than drafts. */
  readonly finalStretch?: number;
}

export function fakeVoiceProvider(options: FakeVoiceOptions = {}) {
  const requests: SynthesisRequest[] = [];
  const clones: { consentId: string; recordingPath: string }[] = [];
  const deleted: string[] = [];
  const provider: VoiceProvider & { requests: SynthesisRequest[]; clones: typeof clones; deleted: string[] } =
    {
      requests,
      clones,
      deleted,
      available: () => ({ ok: true }),
      async synthesize(request) {
        requests.push(request);
        const rate = 48_000;
        const perChar =
          (options.perChar ?? 0.06) * (request.quality === 'final' ? (options.finalStretch ?? 1) : 1);
        const lead = options.leadSeconds ?? 0.15;
        const characters = [...request.text];
        const starts = characters.map((_, i) => lead + i * perChar);
        const ends = starts.map((s) => s + perChar);
        const seconds = lead + characters.length * perChar + (options.tailSeconds ?? 0.25);
        const data = new Float32Array(Math.round(seconds * rate));
        characters.forEach((c, i) => {
          if (c.trim() === '') return;
          const from = Math.round((starts[i] ?? 0) * rate);
          for (let k = 0; k < perChar * rate; k++)
            data[from + k] = 0.2 * Math.sin((2 * Math.PI * 180 * k) / rate);
        });
        return ok({
          bytes: new Uint8Array(encodeFloatWav({ sampleRate: rate, channels: [data] })),
          mediaType: 'audio/wav',
          sampleRate: rate,
          alignment: { characters, startSeconds: starts, endSeconds: ends },
          provider: 'test',
          model: request.quality === 'final' ? 'eleven_v4' : 'eleven_v4_turbo',
          costUsd: request.text.length * (request.quality === 'final' ? 0.00008 : 0.00004),
          c2pa: 'unknown',
        });
      },
      async voices() {
        return ok([{ voiceId: 'v1', name: 'Test voice', labels: {}, own: false }]);
      },
      async createClone(request) {
        clones.push({ consentId: request.consentId, recordingPath: request.recordingPath });
        return ok({ voiceId: `clone-${clones.length}`, requiresVerification: false });
      },
      async deleteClone(voiceId) {
        deleted.push(voiceId);
        return ok(undefined);
      },
    };
  return provider;
}
