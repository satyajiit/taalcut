// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1's fixtures: a synthetic clip made from integers (so its bytes, and the recorded request, are the same on
 * every machine), measurements for it, and `audio.cloudCritique`'s deps with fakes the tests can watch. The record
 * and replay runs share all of it, so they send byte-identical requests.
 */
import {
  defineError,
  err,
  FrameRate,
  newId,
  ok,
  RationalTime,
  type ArtifactInput,
  type AsyncResult,
  type SoundMeasures,
} from '@taalcut/core';
import {
  createModelRuntime,
  type CloudCritiqueDeps,
  type CritiqueFacts,
  type ModelChoice,
  type ModelClient,
  type PreparedCritiqueAudio,
} from '@taalcut/models';
import { GEMINI } from './scenarios';

/**
 * The app's code, declared once in @taalcut/audio (listen/errors.ts) and handed back by the root's consent check.
 * A test file runs in its own module graph, so declaring it here clashes with nothing.
 */
export const ConsentRequired = defineError('audio.cloud_critique_consent_required');

const RATE = 8000;
const SAMPLES = 2000;

/** 0.25 s of a fading 400 Hz square wave as a 16-bit mono 8 kHz WAV: integers only, so every run makes these bytes. */
export function syntheticClip(): Uint8Array {
  const data = Buffer.alloc(SAMPLES * 2);
  for (let i = 0; i < SAMPLES; i++) {
    const level = Math.trunc((6000 * (SAMPLES - i)) / SAMPLES);
    data.writeInt16LE(i % 20 < 10 ? level : -level, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([header, data]));
}

export const CLIP_SECONDS = SAMPLES / RATE;

export const MEASURES: SoundMeasures = {
  duration: RationalTime.of(250, FrameRate.of(1000, 1)),
  lufs: -14.2,
  truePeakDbtp: -1.3,
  peakDbfs: -1.6,
  lraLu: null,
  crestLu: null,
  noiseFloorDbfs: -48.5,
  nearSilent: false,
  bandwidthHz: 8000,
  brightnessHz: 1900,
  bands: null,
  sideToMidDb: null,
};

/** The answer the recorded response carries: hand-written in the rubric's shape. */
export const RECORDED_ANSWER = JSON.stringify({
  overall: { score: 4, verdict: 'A clean level, but the tone reads as a test beep, not a designed sound' },
  scores: { sync: null, realism: 3, mix_balance: 7, loudness: 6, music: null },
  notes: { realism: 'A bare square wave with a straight fade.', mix_balance: '' },
  synthetic_or_cheap: [{ start: 0, end: 0.25, what: 'the tone', why: 'a plain square wave, no body' }],
  issues: [
    {
      start: 0.05,
      end: 0.2,
      severity: 'low',
      category: 'mix',
      problem: 'Harsh odd harmonics',
      fix: 'Low-pass at 4 kHz',
    },
    {
      start: 0,
      end: 0.25,
      severity: 'high',
      category: 'realism',
      problem: 'Reads as a test tone',
      fix: 'Swap it for a designed tap',
    },
  ],
  strengths: ['No clipping'],
  top_fixes: ['Swap the tone for a designed tap', 'Low-pass at 4 kHz'],
});

export interface Watch {
  prepared: number;
  done: number;
  facts: { timeline: boolean }[];
  consentAsked: number;
}

export interface FakeDepsOptions {
  readonly models: ModelClient;
  readonly chain?: readonly ModelChoice[];
  readonly localOnly?: () => boolean;
  readonly consent?: () => AsyncResult<void>;
  readonly facts?: (timeline: boolean) => AsyncResult<CritiqueFacts>;
}

export function critiqueDeps(options: FakeDepsOptions): { deps: CloudCritiqueDeps; watch: Watch } {
  const watch: Watch = { prepared: 0, done: 0, facts: [], consentAsked: 0 };
  const bytes = syntheticClip();
  const audio: PreparedCritiqueAudio = {
    name: '/Users/someone/Movies/launch-sting.wav',
    bytes,
    mimeType: 'audio/wav',
    window: { startS: 0, endS: CLIP_SECONDS, fileSeconds: CLIP_SECONDS, codec: 'wav mono 8 kHz' },
    trimmed: false,
    facts: async ({ timeline }) => {
      watch.facts.push({ timeline });
      return options.facts ? options.facts(timeline) : ok({ measures: MEASURES, notes: [] });
    },
    done: async () => {
      watch.done++;
    },
  };
  const deps: CloudCritiqueDeps = {
    models: options.models,
    chain: () => options.chain ?? [{ provider: 'taalcut-local', model: 'qwen3.5-4b' }, GEMINI],
    runtime: createModelRuntime({ builtinProviders: ['google'] }),
    localOnly: options.localOnly ?? (() => false),
    consent: {
      check: async () => {
        watch.consentAsked++;
        return options.consent ? options.consent() : ok(undefined);
      },
    },
    audio: {
      prepare: async () => {
        watch.prepared++;
        return ok(audio);
      },
    },
  };
  return { deps, watch };
}

export const refuseConsent = async () => err(ConsentRequired());

/** A tool context like the executor's, with what the tool reported. */
export function toolContext() {
  const usage: unknown[] = [];
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async (artifact: ArtifactInput) =>
        ok({ id: newId<'Artifact'>(), mediaType: artifact.mediaType, bytes: 0, summary: artifact.summary }),
      get: async () => {
        throw new Error('not read');
      },
    },
    reportUsage: (u: unknown) => void usage.push(u),
    reportProgress: () => undefined,
  };
  return { ctx, usage };
}
