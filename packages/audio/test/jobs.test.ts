// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Job metadata, and handlers that do not need ffmpeg or a model file. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDirectJobRunner,
  ok,
  type CloudSpeechToText,
  type JobKind,
  type Transcript,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, describe, expect, it } from 'vitest';
import type { AudioJobDeps } from '../src/jobs/deps';
import { createAudioJobs } from '../src/jobs/handlers';
import {
  audioDetectLanguageJob,
  audioMeasureJob,
  audioTrackBeatsJob,
  audioTranscribeCloudJob,
  audioTranscribeParakeetJob,
  audioTranscribeWhisperJob,
} from '../src/jobs/kinds';
import { ModelMissing } from '../src/errors';
import { msRange } from '../src/rates';

const media: MediaContext = { binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'env' } };

const hello: Transcript = {
  version: 1,
  language: 'en',
  segments: [
    {
      text: 'hello',
      range: msRange(0, 400),
      language: 'en',
      words: [{ text: 'hello', range: msRange(0, 400), confidence: 0.9 }],
    },
  ],
  engine: 'scribe',
  model: 'scribe_v2',
  local: false,
  wordTiming: 'native',
};

function settings(consent: boolean): AudioJobDeps['settings'] {
  return {
    hasSpeechUploadConsent: () => consent,
    localOnly: () => false,
    tier: () => 'recommended',
  };
}

function deps(over: Partial<AudioJobDeps> = {}): AudioJobDeps {
  return {
    media,
    settings: settings(false),
    whisper: { binary: '', tiny: '', small: '', medium: '' },
    beats: {
      onnx: { openSession: async () => errMissing() },
      modelDir: '/tmp/taalcut-no-beat-model',
    },
    ...over,
  };
}

function errMissing() {
  return { ok: false as const, error: ModelMissing({ component: 'beat-this' }) };
}

function keyOf<I>(job: JobKind<I, unknown>, input: I): string {
  if (!job.idempotencyKey) throw new Error(`${job.kind} has no idempotency key`);
  return job.idempotencyKey(input);
}

describe('audio job kinds', () => {
  it('matches the spec timeouts, retries, resources and low priority', () => {
    const rows = [
      [audioMeasureJob, 'cpu', 600_000, 2],
      [audioDetectLanguageJob, 'gpu', 300_000, 2],
      [audioTranscribeParakeetJob, 'npu', 3_600_000, 2],
      [audioTranscribeWhisperJob, 'gpu', 7_200_000, 2],
      [audioTranscribeCloudJob, 'network', 3_600_000, 1],
      [audioTrackBeatsJob, 'gpu', 600_000, 2],
    ] as const;
    for (const [job, resource, timeoutMs, maxAttempts] of rows) {
      expect(job.resource).toBe(resource);
      expect(job.timeoutMs).toBe(timeoutMs);
      expect(job.retry.maxAttempts).toBe(maxAttempts);
      expect(job.priority).toBe('low');
      expect(job.resumable).toBe(true);
    }
    expect(audioMeasureJob.retry.backoff).toEqual({ kind: 'fixed', delayMs: 500 });
    expect(audioTranscribeParakeetJob.resource).toBe('npu');
  });

  it('builds stable idempotency keys that contain :v1:', () => {
    const measure = keyOf(audioMeasureJob, { path: '/tmp/clip.wav', contentHash: 'abc' });
    expect(measure).toBe(keyOf(audioMeasureJob, { path: '/tmp/clip.wav', contentHash: 'abc' }));
    expect(measure).toContain(':v1:');
    expect(measure.startsWith('audio.measure:v1:')).toBe(true);
    expect(measure.endsWith(':all:-')).toBe(true);
    const ranged = keyOf(audioMeasureJob, { path: '/tmp/clip.wav', range: msRange(0, 1000) });
    expect(ranged).toContain(':0-1000:-');
    expect(ranged).not.toBe(measure);
    const whisper = keyOf(audioTranscribeWhisperJob, {
      path: '/tmp/clip.wav',
      language: 'hi',
      model: 'small',
    });
    expect(whisper).toContain(':v1:');
    expect(whisper.endsWith(':all:hi')).toBe(true);
  });
});

describe('audio job handlers', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns a null language when there are no slices', async () => {
    const runner = createDirectJobRunner(createAudioJobs(deps()));
    const result = await runner.run(audioDetectLanguageJob, { path: '/tmp/clip.wav', slices: [] });
    expect(result.ok && result.value).toEqual({ language: null, probability: null, perSlice: [] });
  });

  it('does not call cloud speech without consent', async () => {
    const calls: unknown[] = [];
    const cloud: CloudSpeechToText = {
      cloudFirst: () => true,
      providers: () => ['elevenlabs'],
      estimate: () => ({ usd: 0.02, provider: 'elevenlabs', model: 'scribe_v2' }),
      transcribe: async (request) => {
        calls.push(request);
        return ok(hello);
      },
    };
    const runner = createDirectJobRunner(createAudioJobs(deps({ cloud, settings: settings(false) })));
    const result = await runner.run(audioTranscribeCloudJob, { path: '/tmp/clip.wav' });
    expect(result.ok && result.value).toEqual({ skipped: 'no_consent' });
    expect(calls).toEqual([]);
  });

  it('returns the cloud transcript when consent is granted', async () => {
    const calls: unknown[] = [];
    const cloud: CloudSpeechToText = {
      cloudFirst: () => true,
      providers: () => ['elevenlabs'],
      estimate: () => null,
      transcribe: async (request) => {
        calls.push(request);
        return ok(hello);
      },
    };
    const runner = createDirectJobRunner(createAudioJobs(deps({ cloud, settings: settings(true) })));
    const result = await runner.run(audioTranscribeCloudJob, { path: '/tmp/clip.wav', language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ engine: 'scribe', model: 'scribe_v2', local: false });
    expect(calls).toHaveLength(1);
  });

  it('reports parakeet unavailable without a sidecar', async () => {
    const runner = createDirectJobRunner(createAudioJobs(deps()));
    const result = await runner.run(audioTranscribeParakeetJob, { path: '/tmp/clip.wav', language: 'en' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('audio.engine_unavailable');
    expect(result.error.params).toMatchObject({ engine: 'parakeet' });
    expect(result.error.detail).toBe('no Parakeet helper in this process');
  });

  it('reports the beat model missing from an empty directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-beats-'));
    dirs.push(dir);
    const runner = createDirectJobRunner(
      createAudioJobs(deps({ beats: { ...deps().beats, modelDir: dir } })),
    );
    const result = await runner.run(audioTrackBeatsJob, { path: '/tmp/clip.wav' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('audio.model_missing');
  });
});
