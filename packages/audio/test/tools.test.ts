// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Tool metadata for both speech placements, plus a loudness run against a fake job. */
import {
  newId,
  NO_TOOL_RETRY,
  NotFoundError,
  err,
  ok,
  toolModuleProblems,
  type AsyncResult,
  type JobRunner,
  type ToolContextBase,
} from '@taalcut/core';
import { fileFingerprint, type MediaContext } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import type { AudioToolDeps } from '../src/tools/module';
import { audioToolModule } from '../src/tools/module';
import { measureLoudnessOutputSchema } from '../src/tools/schemas';
import { ModelMissing } from '../src/errors';

const SUMMARIES = {
  'audio.trackBeats':
    "Finds the beats, downbeats and tempo of a song or a video's sound, checked against onset strength.",
  'audio.transcribe': 'Transcribes speech with word timings, picking the engine by the detected language.',
  'audio.classifyAudio':
    "Says whether a clip's sound is music, voice, original sound or a mix, with the evidence.",
  'audio.measureLoudness': 'Measures integrated loudness (LUFS), loudness range and true peak of a file.',
} as const;

const media: MediaContext = { binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'env' } };

function deps(cloudFirst: boolean, jobs?: JobRunner): AudioToolDeps & { estimatedMs: number } {
  const state = { estimatedMs: 0 };
  const cloud = {
    cloudFirst: () => cloudFirst,
    providers: () => ['elevenlabs'],
    estimate: (durationMs: number) => {
      state.estimatedMs = durationMs;
      return { usd: 0.02, provider: 'elevenlabs', model: 'scribe_v2' };
    },
    transcribe: async () => ok({} as never),
  };
  const built: AudioToolDeps = {
    media,
    settings: {
      localOnly: () => false,
      tier: () => 'recommended',
    } as AudioToolDeps['settings'],
    cloud,
    whisper: { binary: '', tiny: '', small: '', medium: '' },
    beats: {
      onnx: { openSession: async () => err(ModelMissing({ component: 'beat-this' })) },
      modelDir: '/tmp/taalcut-no-beat-model',
    },
    jobs: jobs ?? { run: async () => err(NotFoundError({ entity: 'job kind' })) },
  };
  const returned = Object.assign(built, state);
  Object.defineProperty(returned, 'estimatedMs', { get: () => state.estimatedMs });
  return returned;
}

function context(): ToolContextBase {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: {
      put: async (artifact) =>
        ok({
          id: newId<'Artifact'>(),
          mediaType: artifact.mediaType,
          bytes:
            typeof artifact.data === 'string' ? Buffer.byteLength(artifact.data) : artifact.data.byteLength,
          summary: artifact.summary,
        }),
      get: async () => err(NotFoundError({ entity: 'artifact' })),
    },
    reportUsage: () => undefined,
    reportProgress: () => undefined,
  };
}

function tool(moduleId: ReturnType<typeof audioToolModule>, name: string) {
  const found = moduleId.tools.find((item) => item.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe('audio tool module', () => {
  it('is a valid local module', () => {
    const local = audioToolModule(deps(false));
    expect(toolModuleProblems(local)).toEqual([]);
    expect(local.tools.map((item) => item.name)).toEqual([
      'audio.trackBeats',
      'audio.transcribe',
      'audio.classifyAudio',
      'audio.measureLoudness',
      'audio.recommendDspChain',
      'audio.snapToGroove',
    ]);
    for (const item of local.tools.filter((entry) => entry.name in SUMMARIES)) {
      expect(item.version).toBe('1.0.0');
      expect(item.summary).toBe(SUMMARIES[item.name as keyof typeof SUMMARIES]);
      expect(item.summary!.length).toBeLessThanOrEqual(120);
      expect(item.permission?.filesystem?.read).toEqual(['library', 'user-selected', 'scratch']);
      expect(item.permission?.network).toBe('none');
      expect(item.sideEffect).toBe('read');
      expect(item.costClass).toBe('local');
      expect(item.retry.maxAttempts).toBe(2);
      expect(item.cache).toEqual({ ttlMs: 3_600_000 });
      expect(item.permission?.cloudModules).toBeUndefined();
    }
    const transcribe = tool(local, 'audio.transcribe');
    expect(transcribe.permission?.uploads).toBeUndefined();
    const beats = tool(local, 'audio.trackBeats');
    expect(beats.tags).toEqual(['beats', 'tempo', 'downbeat', 'onset']);
    expect(beats.timeoutMs).toBe(180_000);
    expect(tool(local, 'audio.classifyAudio').timeoutMs).toBe(300_000);
    expect(tool(local, 'audio.measureLoudness').timeoutMs).toBe(120_000);
    expect(transcribe.timeoutMs).toBe(900_000);
  });

  it('discovers the local DSP and groove queries in the audio module', async () => {
    const module = audioToolModule(deps(false));
    expect(toolModuleProblems(module)).toEqual([]);
    for (const name of ['audio.recommendDspChain', 'audio.snapToGroove']) {
      expect(tool(module, name).costClass).toBe('local');
    }
    const query = tool(module, 'audio.recommendDspChain');
    const result = await query.run(
      query.input.parse({ role: 'dialogue', integratedLufs: -20, truePeakDbtp: -8 }),
      context(),
    );
    expect(result.ok).toBe(true);
  });

  it('registers cloud transcribe when the speech chain is cloud-first', () => {
    const built = deps(true);
    const cloud = audioToolModule(built);
    expect(toolModuleProblems(cloud)).toEqual([]);
    const transcribe = tool(cloud, 'audio.transcribe');
    expect(transcribe.costClass).toBe('cloud');
    expect(transcribe.sideEffect).toBe('external');
    expect(transcribe.retry).toBe(NO_TOOL_RETRY);
    expect(transcribe.retry.maxAttempts).toBe(1);
    expect(transcribe.cache).toBeUndefined();
    expect(transcribe.permission?.network).toBe('internet');
    expect(transcribe.permission?.cloudModules).toEqual(['speech']);
    expect(transcribe.permission?.uploads).toEqual({ what: 'user-media', consent: 'first-use' });
    const estimate = transcribe.estimateCost?.({ path: '/tmp/clip.wav' });
    expect(estimate?.usd).toBe(0.02);
    expect(estimate?.basis).toContain('60000');
    expect(built.estimatedMs).toBe(60_000);
    expect(tool(cloud, 'audio.measureLoudness').permission?.network).toBe('none');
  });

  it('keys repeats on the file fingerprint, range and language', () => {
    const local = audioToolModule(deps(false));
    const path = '/tmp/missing-audio.wav';
    const fingerprint = fileFingerprint(path);
    const beats = tool(local, 'audio.trackBeats').idempotencyKey?.({ path });
    expect(beats).toContain(fingerprint);
    expect(beats).toContain('all');
    expect(beats).toBe(tool(local, 'audio.trackBeats').idempotencyKey?.({ path }));
    const spoken = tool(local, 'audio.transcribe').idempotencyKey?.({ path, language: 'hi' });
    expect(spoken).toContain(fingerprint);
    expect(spoken).toContain('hi');
    expect(spoken).not.toBe(tool(local, 'audio.transcribe').idempotencyKey?.({ path, language: 'en' }));
  });

  it('names no language over a transcript that wrote nothing down (LIB1-LANG)', async () => {
    // A second or two of speech the transcriber couldn't place: it still names a language, with no segments.
    const jobs: JobRunner = {
      async run<_I, O>(job: { kind: string }): AsyncResult<O> {
        if (job.kind === 'audio.measure')
          return ok({
            nonSilentRatio: 0.4,
            nonSilentMs: 1600,
            durationMs: 4000,
            stretches: [],
            slices: [],
          } as O);
        return ok({
          version: 1,
          language: 'ne',
          segments: [],
          engine: 'whisper',
          model: 'ggml-medium',
          local: true,
          wordTiming: 'native',
        } as O);
      },
    };
    const transcribe = tool(audioToolModule(deps(false, jobs)), 'audio.transcribe');
    const result = await transcribe.run({ path: '/tmp/clip.wav', language: 'hi' }, context());
    expect(result.ok && result.value).toMatchObject({ language: 'und', text: '' });
  });

  it('returns loudness fields from the measure job', async () => {
    const jobs: JobRunner = {
      async run<_I, O>(): AsyncResult<O> {
        return ok({
          integratedLufs: -16.5,
          loudnessRange: 7.2,
          truePeakDbtp: -1.1,
          nonSilentRatio: 1,
          nonSilentMs: 2000,
          durationMs: 2000,
          stretches: [],
          slices: [],
        } as O);
      },
    };
    const loudness = tool(audioToolModule(deps(false, jobs)), 'audio.measureLoudness');
    const result = await loudness.run({ path: '/tmp/clip.wav' }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(measureLoudnessOutputSchema.parse(result.value)).toEqual({
      integratedLufs: -16.5,
      loudnessRange: 7.2,
      truePeakDbtp: -1.1,
    });
  });
});
