// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F7 jobs and the SoundListener: `createJobSoundListener` sends render's question as one
 * `audio.listen.analyse` job (validated as the engine would) and turns the answer into core's RenderListening; the
 * jobs answer analyses and queries from a listen service; a file runs end to end through a direct runner (real
 * FFmpeg, signal processing only).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDirectJobRunner,
  err,
  newId,
  ok,
  RationalTime,
  renderListeningSchema,
  type AsyncResult,
  type JobKind,
  type JobRunner,
  type JobRunOptions,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createListenService } from '../../src/listen/analysis/service';
import { EMPTY_ANALYSIS, soundAnalysisSchema, type SoundAnalysis } from '../../src/listen/analysis/schema';
import { describeQuery } from '../../src/listen/analysis/queries';
import {
  audioListenAnalyseJob,
  audioListenQueryJob,
  createListenJobs,
  runListenQuery,
} from '../../src/listen/jobs';
import { createJobSoundListener } from '../../src/listen/listener';
import { ListenModelMissing } from '../../src/listen/errors';
import { encodeFloatWav } from '../../src/pcm/pcm';
import { testMedia } from '../helpers/ffmpeg';
import { hitsAt } from './dsp-signals';

const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });
const CUTS = [0.5, 1.25, 2.0];

const answer: SoundAnalysis = {
  ...EMPTY_ANALYSIS,
  measures: {
    duration: RationalTime.of(48_000 * 3, { num: 48_000, den: 1 }),
    lufs: -14,
    truePeakDbtp: -1,
    peakDbfs: -1.2,
    lraLu: null,
    crestLu: 8,
    noiseFloorDbfs: -60,
    nearSilent: false,
    bandwidthHz: 16_000,
    brightnessHz: 2400,
    bands: null,
    sideToMidDb: null,
  },
  audit: { ok: true, findings: [] },
};

/** A runner that checks the job as the engine does (input, then the output through JSON) and remembers it. */
function fakeRunner(reply: (input: unknown) => AsyncResult<unknown>) {
  const calls: { kind: string; input: unknown; options: JobRunOptions }[] = [];
  const runner: JobRunner = {
    async run<I, O>(kind: JobKind<I, O>, input: I, options: JobRunOptions = {}): AsyncResult<O> {
      const parsed = kind.input.safeParse(input);
      if (!parsed.success) throw new Error(`bad ${kind.kind} input: ${parsed.error.message}`);
      calls.push({ kind: kind.kind, input: parsed.data, options });
      const out = await reply(parsed.data);
      if (!out.ok) return out;
      const stored = kind.output.safeParse(JSON.parse(JSON.stringify(out.value)));
      if (!stored.success) throw new Error(`bad ${kind.kind} output: ${stored.error.message}`);
      return ok(stored.data);
    },
  };
  return { runner, calls };
}

describe('createJobSoundListener', () => {
  it('round-trips render’s question through the runner as one audio.listen.analyse job', async () => {
    const { runner, calls } = fakeRunner(async () =>
      ok({ ...answer, realness: { pReal: 0.9, verdict: 'real' } }),
    );
    const parentJobId = newId<'Job'>();
    const listener = createJobSoundListener(runner, { priority: 'high' });
    const heard = await listener.hearRender({
      file: '/work/render.mp4',
      cuts: CUTS.map(ms),
      beats: [ms(0.5), ms(1.0)],
      frameRate: { num: 30, den: 1 },
      profile: 'launch',
      parentJobId,
    });
    expect(heard.ok).toBe(true);
    if (!heard.ok) return;
    expect(renderListeningSchema.safeParse(heard.value).success).toBe(true);
    expect(heard.value.realness).toEqual({ pReal: 0.9, verdict: 'real' });
    expect(heard.value.cutSync.items).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('audio.listen.analyse');
    expect(calls[0]?.input).toMatchObject({
      path: '/work/render.mp4',
      cuts: CUTS.map(ms),
      frameRate: { num: 30, den: 1 },
      want: { measures: true, events: true, audit: true, realness: true },
      critique: { profile: 'launch' },
      install: false,
      optionalModels: true,
    });
    expect(calls[0]?.options).toMatchObject({ parentJobId, priority: 'high' });
  });

  it('passes the job’s error on', async () => {
    const { runner } = fakeRunner(async () => err(ListenModelMissing({ component: 'clap-general-audio' })));
    const heard = await createJobSoundListener(runner).hearRender({
      file: '/r.mp4',
      cuts: [],
      profile: 'launch',
    });
    expect(!heard.ok && heard.error.code).toBe('audio.listen_model_missing');
  });
});

describe('the listen jobs', () => {
  it('serve analyses and queries from the service; queries are typed by their operation', async () => {
    const asked: string[] = [];
    const jobs = createListenJobs({
      analyse: async (request) => (asked.push(`analyse:${request.path}`), ok(answer)),
      query: async (op, sources, params) => (
        asked.push(`query:${op}:${sources.length}`),
        ok([{ op, params }])
      ),
    });
    expect(jobs.map((job) => job.kind.kind)).toEqual(['audio.listen.analyse', 'audio.listen.query']);
    const runner = createDirectJobRunner(jobs);
    const analysed = await runner.run(audioListenAnalyseJob, { path: '/a.wav', want: { measures: true } });
    expect(analysed.ok && soundAnalysisSchema.safeParse(analysed.value).success).toBe(true);
    const described = await runListenQuery(runner, describeQuery, [{ path: '/a.wav' }], { top: 3 });
    expect(described.ok && described.value).toEqual([{ op: 'describe', params: { top: 3 } }]);
    const bad = await runListenQuery(runner, describeQuery, [{ path: '/a.wav' }], { top: 99 });
    expect(!bad.ok && bad.error.code).toBe('audio.listen_bad_input');
    expect(asked).toEqual(['analyse:/a.wav', 'query:describe:1']);
  });

  it('an analysis is idempotent by content hash only', () => {
    const key = audioListenAnalyseJob.idempotencyKey!;
    const base = { path: '/a.wav', want: { measures: true } };
    expect(key(base)).not.toBe(key(base));
    expect(key({ ...base, contentHash: 'h' })).toBe(key({ ...base, path: '/b.wav', contentHash: 'h' }));
    expect(key({ ...base, contentHash: 'h' })).not.toBe(
      key({ ...base, contentHash: 'h', want: { events: true } }),
    );
    expect(audioListenQueryJob.lane).toBe('audio.listen');
  });

  it('a query without models is unavailable, an unknown operation bad input', async () => {
    const service = createListenService({ media: async () => err(ListenModelMissing({ component: 'x' })) });
    const unknown = await service.query('nope', [{ path: '/a.wav' }], {});
    expect(!unknown.ok && unknown.error.code).toBe('audio.listen_bad_input');
    const none = await service.query('describe', [{ path: '/a.wav' }], {});
    expect(!none.ok && none.error.code).toBe('audio.listen_unavailable');
  });
});

const media = await testMedia('listen jobs');
let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'listen-jobs-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!media.ctx)(`a file through the jobs${media.skip ? ` (${media.skip})` : ''}`, () => {
  it('analyses a WAV in the jobs process and answers render’s listener, no model installed', async () => {
    const ctx = media.ctx as MediaContext;
    const samples = hitsAt(CUTS, 3);
    const path = join(dir, 'render.wav');
    await writeFile(path, encodeFloatWav({ sampleRate: 48_000, channels: [samples, samples] }));
    const service = createListenService({
      media: async () => ok(ctx),
      spectrogram: {},
      plan: async () => ({ devices: ['cpu'] }),
    });
    const runner = createDirectJobRunner(createListenJobs(service));
    const heard = await createJobSoundListener(runner).hearRender({
      file: path,
      cuts: CUTS.map(ms),
      profile: 'launch',
    });
    await service.release();
    expect(heard.ok).toBe(true);
    if (!heard.ok) return;
    expect(heard.value.model).toBeNull();
    expect(heard.value.realness).toBeNull();
    expect(heard.value.cutSync.items.map((item) => item.status)).toEqual(['ok', 'ok', 'ok']);
    expect(heard.value.measures.sideToMidDb).toBeNull();
    // Stereo, duplicated: the levels sum two channels as earshot's do.
    expect(heard.value.measures.peakDbfs).toBeGreaterThan(-3);
  });
});
