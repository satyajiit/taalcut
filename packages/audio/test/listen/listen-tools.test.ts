// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A3 tool contracts: `audio.listen`, `audio.compare` and `audio.critique` declare their metadata (local, read,
 * 120 s, the local retry, no network, one-line summaries, no tool-layer cache), send the listening to the jobs
 * process (`audio.listen.analyse`, or `audio.listen.query`'s rank and `ab`), mark genre and mood as hints, spill over
 * 8 KiB, and are cached where the key holds the models, their dtype and the listen config (the analysis cache).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineToolModule,
  err,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  toolModuleProblems,
  type AnyTool,
  type ArtifactStore,
  type AssetId,
  type JobRunner,
  type SoundTag,
  type StoredArtifact,
  type ToolContextBase,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_ANALYSIS, type SoundAnalysis } from '../../src/listen/analysis/schema';
import { listenCacheKey } from '../../src/listen/analysis/cache';
import { critiqueOutputSchema, critiqueTool } from '../../src/tools/critique-tool';
import { compareOutputSchema, listenOutputSchema, listenTools } from '../../src/tools/listen-tools';

function memoryArtifacts(): ArtifactStore {
  const stored = new Map<string, StoredArtifact>();
  return {
    async put(input) {
      const data = typeof input.data === 'string' ? new TextEncoder().encode(input.data) : input.data;
      const ref = {
        id: newId<'Artifact'>(),
        mediaType: input.mediaType,
        bytes: data.length,
        summary: input.summary,
      };
      stored.set(ref.id, { ref, data });
      return ok(ref);
    },
    async get(id) {
      const found = stored.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'artifact', id }));
    },
  };
}

const context = (): ToolContextBase => ({
  signal: new AbortController().signal,
  callId: newId<'ToolRun'>(),
  attempt: 1,
  artifacts: memoryArtifacts(),
  reportUsage: () => undefined,
  reportProgress: () => undefined,
});

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'taalcut-listen-qa-tools-'));
});
afterEach(() => rm(scratch, { recursive: true, force: true }));

const assetId = newId<'Asset'>();
const other = newId<'Asset'>();
const assets = {
  original: async (id: AssetId) =>
    ok({ path: `/library/${id === assetId ? 'a' : 'b'}.wav`, size: 10, mtimeMs: 1 }),
};
const tag = (term: string, z: number, hint = false): SoundTag => ({
  term,
  category: hint ? 'music_mood' : 'impacts',
  cosine: 0.3,
  z,
  verdict: hint ? null : z >= 3 ? 'strong' : 'weak',
  hint,
  borderline: false,
});

const heard: SoundAnalysis = {
  ...EMPTY_ANALYSIS,
  measures: {
    duration: RationalTime.of(48_000, { num: 48_000, den: 1 }),
    lufs: -16,
    truePeakDbtp: -1.4,
    peakDbfs: -1.6,
    lraLu: null,
    crestLu: null,
    noiseFloorDbfs: -70,
    nearSilent: false,
    bandwidthHz: 16_000,
    brightnessHz: 2400,
    bands: null,
    sideToMidDb: null,
  },
  tags: {
    tags: [tag('a deep cinematic impact', 3.4)],
    hints: [tag('dark and tense', 2.6, true)],
    audioSet: [{ label: 'Thump, thud', score: 0.4 }],
    musicP: 0.1,
    nearSilent: false,
    tooShort: false,
    character: [],
  },
  realness: { pReal: 0.82, verdict: 'real' },
  critique: {
    profile: 'launch',
    verdict: 'needs_work',
    score: 0.6,
    partial: true,
    metrics: [{ id: 'lufsI', weight: 3, value: -21, range: { min: -16, max: -9 }, status: 'low' }],
    fixes: [{ metricId: 'lufsI', messageKey: 'audio.critique.fix.lufsLow', params: { gainDb: 7 } }],
  },
};

function fakeJobs(answer: (kind: string, input: Record<string, unknown>) => unknown) {
  const calls: { kind: string; input: Record<string, unknown> }[] = [];
  const jobs: Pick<JobRunner, 'run'> = {
    run: (async (kind: { kind: string }, input: Record<string, unknown>) => {
      calls.push({ kind: kind.kind, input });
      return ok(answer(kind.kind, input));
    }) as unknown as JobRunner['run'],
  };
  return { jobs, calls };
}

function expectMetadata(tool: AnyTool, name: string) {
  expect(tool).toMatchObject({
    name,
    version: '1.0.0',
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 120_000,
    retry: { maxAttempts: 2, initialDelayMs: 1000 },
    permission: { network: 'none' },
  });
  expect(tool.summary).toMatch(/^[^\n]{10,110}$/);
  // The tool layer's cache keys (tool, version, input) can't see the models: the analysis cache answers repeats.
  expect(tool.cache).toBe(false);
}

const toolsOf = (jobs: Pick<JobRunner, 'run'>) => [
  ...listenTools({ jobs, assets, scratch }),
  critiqueTool({ jobs, assets, scratch }),
];

describe('lane A’s listening tools', () => {
  it('declare their metadata and join the audio module cleanly', () => {
    const tools = toolsOf(fakeJobs(() => heard).jobs);
    expect(tools.map((t) => t.name)).toEqual(['audio.listen', 'audio.compare', 'audio.critique']);
    for (const t of tools) expectMetadata(t, t.name);
    expect(toolModuleProblems(defineToolModule({ id: 'audio', tools }))).toEqual([]);
  });

  it('the analysis cache key holds the models (and their dtype) and the listen config', () => {
    const options = { want: { measures: true } };
    const fp16 = listenCacheKey('a'.repeat(64), 'clap-general-audio-fp16', options);
    expect(listenCacheKey('a'.repeat(64), 'clap-general-audio', options)).not.toBe(fp16);
    expect(listenCacheKey('a'.repeat(64), 'clap-general-audio-fp16', options)).toBe(fp16);
    expect(fp16).toContain('.listen.');
  });

  it('audio.listen hears each sound in the jobs process and marks genre and mood as hints', async () => {
    const { jobs, calls } = fakeJobs(() => heard);
    const [listen] = toolsOf(jobs);
    const out = await listen?.run({ sources: [{ assetId }] }, context());
    if (!out?.ok) throw new Error('no answer');
    const parsed = listenOutputSchema.parse(out.value);
    if (!('sounds' in parsed)) throw new Error('spilled');
    expect(parsed.sounds?.[0]).toMatchObject({
      tags: [{ term: 'a deep cinematic impact', verdict: 'strong', hint: false }],
      hints: [{ term: 'dark and tense', verdict: null, hint: true }],
      realness: { pReal: 0.82, verdict: 'real' },
      lufs: -16,
    });
    expect(calls[0]).toMatchObject({
      kind: 'audio.listen.analyse',
      input: { path: '/library/a.wav', want: { tags: true, realness: true, measures: true } },
    });
    expect(listen?.summarize?.(out.value as never)).toMatch(/^[^\n]+$/);
  });

  it('audio.listen ranks several sounds by a description, and spills an answer over 8 KiB', async () => {
    const { jobs, calls } = fakeJobs((_kind, input) => ({
      op: input['op'],
      result: {
        query: 'a riser',
        counts: { strong: 1, plausible: 0, weak: 0 },
        results: Array.from({ length: 20 }, (_, index) => ({
          index,
          z: 3 - index * 0.1,
          cosine: 0.2,
          vocabPercentile: 99,
          verdict: 'strong',
          nearSilent: false,
          soundsMostLike: {
            term: `a long rising riser number ${index} `.repeat(12),
            category: 'whooshes',
            z: 3,
            cosine: 0.2,
          },
        })),
      },
    }));
    const [listen] = toolsOf(jobs);
    const sources = Array.from({ length: 20 }, () => ({ assetId }));
    const out = await listen?.run({ sources, query: 'a riser' }, context());
    if (!out?.ok) throw new Error('no answer');
    expect(calls[0]?.input).toMatchObject({ op: 'rank', params: { query: 'a riser' } });
    expect(out.value).toMatchObject({ artifact: { mediaType: 'application/json' } });
    expect((out.value as { summary: string }).summary).toMatch(/^Ranked 20 for "a riser"/);
  });

  it('audio.compare sends A, B and the references to the jobs process’s ab and says how B differs', async () => {
    const { jobs, calls } = fakeJobs((_kind, input) => ({
      op: input['op'],
      result: {
        cosineAb: 0.64,
        likeness: 'related',
        query: { query: 'a whoosh', za: 4.5, zb: 3.4, closer: 'a' },
        differences: { keys: ['loudness_lufs', 'brightness_hz'], words: '3 dB quieter and brighter' },
        features: [{}, {}],
      },
    }));
    const [, compare] = toolsOf(jobs);
    const out = await compare?.run({ a: { assetId }, b: { assetId: other }, query: 'a whoosh' }, context());
    if (!out?.ok) throw new Error('no answer');
    expect(calls[0]?.input).toMatchObject({ op: 'ab', params: { query: 'a whoosh' } });
    expect(compareOutputSchema.parse(out.value)).toEqual({
      ab: {
        cosine: 0.64,
        likeness: 'related',
        closerToQuery: 'a',
        differences: ['loudness_lufs', 'brightness_hz'],
        words: '3 dB quieter and brighter',
      },
    });
    expect(compare?.summarize?.(out.value as never)).toBe(
      'A and B: related (cosine 0.64); B differs in loudness_lufs, brightness_hz.',
    );
  });

  it('audio.critique asks one analysis with the cuts and the profile and hands back the scorecard', async () => {
    const { jobs, calls } = fakeJobs(() => heard);
    const tools = toolsOf(jobs);
    const critique = tools[2];
    const out = await critique?.run(
      { source: { assetId }, cuts: [1.5, 3], frameRate: { num: 30, den: 1 } },
      context(),
    );
    if (!out?.ok) throw new Error('no answer');
    expect(critiqueOutputSchema.parse(out.value)).toMatchObject({ critique: { verdict: 'needs_work' } });
    expect(calls[0]).toMatchObject({
      kind: 'audio.listen.analyse',
      input: {
        critique: { profile: 'launch' },
        cuts: [
          RationalTime.fromSeconds(1.5, { num: 1000, den: 1 }),
          RationalTime.fromSeconds(3, { num: 1000, den: 1 }),
        ],
        optionalModels: true,
      },
    });
    expect(critique?.summarize?.(out.value as never)).toBe(
      'needs work against launch films (60%, partial): 1 out of range, 1 fix.',
    );
    const reference = await critique?.run(
      { source: { assetId }, profile: 'reference', templateId: newId<'Template'>() },
      context(),
    );
    expect(reference?.ok).toBe(false);
  });
});
