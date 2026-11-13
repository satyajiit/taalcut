// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-B1/B2 tool contracts: `audio.findMoment` and `sfx.searchSounds` declare their metadata (local, read, 120 s,
 * the local retry, no network, one-line summaries), send the listening to the jobs process as `audio.listen.query`,
 * give trims as RationalTime, copy an artifact for the job and remove it, spill over 8 KiB, and return bank ids that
 * `sfx.addHits` takes as `soundIds`.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineToolModule,
  err,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  sfxBankSoundIdSchema,
  toolModuleProblems,
  type AnyTool,
  type ArtifactId,
  type ArtifactStore,
  type StoredArtifact,
  type AssetId,
  type JobRunner,
  type ToolContextBase,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FoundMoments } from '../../src/listen/describe/find';
import type { SearchSoundsResult } from '../../src/listen/search/queries';
import type { SoundSearcher, SoundSearchRequest } from '../../src/listen/search/sound-search';
import {
  findMomentInputSchema,
  findMomentOutputSchema,
  listenSearchTools,
  spillOver,
} from '../../src/tools/listen-search-tools';
import {
  findLibraryTrackInputSchema,
  findLibraryTrackOutputSchema,
} from '../../src/tools/music-library-tools';
import {
  searchSoundsInputSchema,
  searchSoundsOutputSchema,
  searchSoundsTool,
} from '../../src/tools/sfx-search-tool';
import { bankCatalogue, bankItem, fitItem, writeCatalogue } from '../sfx-bank-helpers';

/** The tools' artifact store as a Map. */
function createMemoryArtifactStore(): ArtifactStore {
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

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'taalcut-listen-tools-'));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const found: FoundMoments = {
  query: 'a single key press',
  queryKind: 'event',
  queryKindScore: 0.12,
  kind: 'auto',
  durationS: 40,
  candidates: 60,
  windows: 16,
  plannedWindows: 16,
  events: 44,
  windowS: 5,
  snapped: true,
  twoStage: false,
  nearSilent: false,
  moments: [
    {
      start: 12.381,
      end: 12.49,
      duration: 0.109,
      kind: 'stroke',
      score: 3.1,
      z: 3.1,
      cosine: 0.31,
      verdict: 'strong',
      borderline: false,
      peakDbfs: -6,
      headDb: -40,
      tailDb: -35,
      headCut: false,
      tailCut: false,
    },
  ],
};

function fakeJobs(
  answer: (op: string, input: { sources: Array<{ path: string }>; params: unknown }) => unknown,
) {
  const calls: Array<{
    kind: string;
    input: { op: string; sources: Array<{ path: string }>; params: unknown };
  }> = [];
  const jobs: Pick<JobRunner, 'run'> = {
    run: (async (
      kind: { kind: string },
      input: { op: string; sources: Array<{ path: string }>; params: unknown },
    ) => {
      calls.push({ kind: kind.kind, input });
      return ok({ op: input.op, result: answer(input.op, input) });
    }) as unknown as JobRunner['run'],
  };
  return { jobs, calls };
}

function context(): ToolContextBase {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: createMemoryArtifactStore(),
    reportUsage: () => undefined,
    reportProgress: () => undefined,
  };
}

const assetId = newId<'Asset'>();
const assets = {
  original: async (id: AssetId) =>
    ok(id === assetId ? { path: '/library/typing.wav', size: 10, mtimeMs: 1 } : null),
};

function expectMetadata(tool: AnyTool, name: string, cached = true) {
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
  // EAR1-R2: sfx.searchSounds has no tool-layer cache (its key can't see bank installs or the library).
  expect(Boolean(tool.cache)).toBe(cached);
}

describe('audio.findMoment', () => {
  it('declares its metadata and joins the audio module cleanly', () => {
    const { jobs } = fakeJobs(() => found);
    const tools = listenSearchTools({ jobs, assets, scratch });
    expect(toolModuleProblems(defineToolModule({ id: 'audio', tools }))).toEqual([]);
    expectMetadata(tools[0] as AnyTool, 'audio.findMoment');
  });

  it('asks the jobs process and gives the moments as RationalTime trims', async () => {
    const { jobs, calls } = fakeJobs(() => found);
    const [tool] = listenSearchTools({ jobs, assets, scratch }) as [AnyTool];
    const range = {
      start: RationalTime.of(10_000, { num: 1000, den: 1 }),
      duration: RationalTime.of(5000, { num: 1000, den: 1 }),
    };
    const out = await tool.run(
      tool.input.parse({ assetId, query: 'a single key press', top: 3, range }),
      context(),
    );
    if (!out.ok) throw new Error(out.error.code);
    expect(calls[0]).toMatchObject({
      kind: 'audio.listen.query',
      input: {
        op: 'findMoment',
        sources: [{ path: '/library/typing.wav' }],
        params: { query: 'a single key press', top: 3, start: 10, end: 15 },
      },
    });
    const value = out.value as {
      moments: Array<{ start: RationalTime; end: RationalTime; verdict: string }>;
    };
    expect(RationalTime.toSeconds(value.moments[0]!.start)).toBeCloseTo(12.381, 3);
    expect(RationalTime.toSeconds(value.moments[0]!.end)).toBeCloseTo(12.49, 3);
    expect(value.moments[0]?.verdict).toBe('strong');
    expect(tool.summarize?.(out.value)).toBe(
      '1 moments for "a single key press"; best at 0:12 (z 3.1, strong).',
    );
  });

  it('copies an audio artifact for the job and removes it after', async () => {
    let seen = '';
    const { jobs } = fakeJobs((_op, input) => {
      seen = input.sources[0]?.path ?? '';
      expect(existsSync(seen)).toBe(true);
      return found;
    });
    const [tool] = listenSearchTools({ jobs, assets, scratch }) as [AnyTool];
    const ctx = context();
    const stored = await ctx.artifacts.put({
      mediaType: 'audio/wav',
      data: new Uint8Array(64),
      summary: 'a take',
    });
    if (!stored.ok) throw new Error('put');
    const out = await tool.run(tool.input.parse({ artifactId: stored.value.id, query: 'a whoosh' }), ctx);
    expect(out.ok).toBe(true);
    expect(seen.endsWith('.wav')).toBe(true);
    expect(existsSync(seen)).toBe(false);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('refuses a non-audio artifact and an input with both or neither source', async () => {
    const { jobs } = fakeJobs(() => found);
    const [tool] = listenSearchTools({ jobs, assets, scratch }) as [AnyTool];
    const ctx = context();
    const stored = await ctx.artifacts.put({ mediaType: 'application/json', data: '{}', summary: 'json' });
    if (!stored.ok) throw new Error('put');
    const out = await tool.run(tool.input.parse({ artifactId: stored.value.id, query: 'rain' }), ctx);
    expect(!out.ok && out.error.code).toBe('audio.listen_bad_input');
    expect(tool.input.safeParse({ query: 'rain' }).success).toBe(false);
    expect(
      tool.input.safeParse({ query: 'rain', assetId, artifactId: stored.value.id as ArtifactId }).success,
    ).toBe(false);
  });

  it('stores an output over 8 KiB as an artifact with its one-line summary', async () => {
    const artifacts = createMemoryArtifactStore();
    const big = { rows: Array.from({ length: 400 }, (_, i) => ({ i, text: 'x'.repeat(20) })) };
    const spilled = await spillOver(big, 'a line', artifacts);
    expect(spilled.ok && 'artifact' in spilled.value && spilled.value.summary).toBe('a line');
    const small = await spillOver({ a: 1 }, 'a line', artifacts);
    expect(small).toEqual(ok({ a: 1 }));
  });
});

describe('sfx.searchSounds', () => {
  const result = (request: SoundSearchRequest): SearchSoundsResult => ({
    query: request.query,
    category: 'everyday',
    hint: false,
    dtype: 'fp16',
    stale: [],
    hits: ['whoosh_fast/crisp', 'asset:mine', 'fit/tick_domino'].map((id, i) => ({
      id,
      source: id.startsWith('asset:') ? ('entry' as const) : ('bank' as const),
      z: 3 - i,
      cosine: 0.3,
      verdict: i === 0 ? ('strong' as const) : ('plausible' as const),
      borderline: false,
      nearSilent: false,
      nameScore: 1 - i,
      rankScore: 4 - 2 * i,
      soundsLike: { term: 'a whoosh', category: 'everyday' as const, z: 3 },
    })),
  });

  async function setup() {
    await writeCatalogue(scratch, bankCatalogue([bankItem(), fitItem()]));
    const asked: SoundSearchRequest[] = [];
    const searcher: SoundSearcher = {
      search: async (request) => {
        asked.push(request);
        return ok(result(request));
      },
    };
    const tool = searchSoundsTool({
      searcher,
      bankDir: () => scratch,
      library: async () =>
        ok([
          {
            assetId: 'mine' as AssetId,
            title: 'my-pop.wav',
            path: '/lib/my-pop.wav',
            contentHash: 'f'.repeat(64),
          },
        ]),
    });
    return { tool, asked };
  }

  it('declares its metadata and joins the sfx module cleanly', async () => {
    const { tool } = await setup();
    expect(toolModuleProblems(defineToolModule({ id: 'sfx', tools: [tool] }))).toEqual([]);
    expectMetadata(tool, 'sfx.searchSounds', false);
  });

  it('returns bank sounds with ids sfx.addHits takes, and library sounds with their asset', async () => {
    const { tool, asked } = await setup();
    const out = await tool.run(tool.input.parse({ query: 'a fast whoosh', top: 3 }), context());
    if (!out.ok) throw new Error(out.error.code);
    expect(asked[0]).toMatchObject({ query: 'a fast whoosh', top: 3, bankDir: scratch });
    expect(asked[0]?.sounds?.map((s) => s.id)).toEqual(['asset:mine']);
    const value = out.value as { sounds: Array<Record<string, unknown>>; skipped: string[] };
    expect(value.sounds[0]).toMatchObject({
      source: 'bank',
      soundId: 'whoosh_fast/crisp',
      title: 'Whoosh fast, crisp',
      family: 'whoosh',
      licence: 'MIT',
      verdict: 'strong',
    });
    expect(value.sounds[1]).toMatchObject({ source: 'library', assetId: 'mine', family: null });
    expect(value.sounds[2]).toMatchObject({ soundId: 'fit/tick_domino', licence: 'MIT' });
    for (const sound of value.sounds)
      if (sound.soundId) expect(sfxBankSoundIdSchema.safeParse(sound.soundId).success).toBe(true);
    expect(value.skipped).toEqual(['pack']);
  });

  it('a family keeps to the bank and the pack', async () => {
    const { tool, asked } = await setup();
    const out = await tool.run(tool.input.parse({ query: 'a hit', family: 'hit' }), context());
    expect(out.ok).toBe(true);
    expect(asked[0]).toMatchObject({ bankFamily: 'hit', sounds: [] });
  });
});

describe("the tools' schemas", () => {
  it('export to JSON Schema for tool calling (inputs as input, outputs as output)', () => {
    const pairs = [
      [findMomentInputSchema, 'input'],
      [findMomentOutputSchema, 'output'],
      [searchSoundsInputSchema, 'input'],
      [searchSoundsOutputSchema, 'output'],
      [findLibraryTrackInputSchema, 'input'],
      [findLibraryTrackOutputSchema, 'output'],
    ] as const;
    const failed = pairs.flatMap(([schema, io], i) => {
      try {
        z.toJSONSchema(schema as z.ZodType, { target: 'draft-2020-12', io, unrepresentable: 'throw' });
        return [];
      } catch (error) {
        return [`${i} (${io}): ${String(error)}`];
      }
    });
    expect(failed).toEqual([]);
  });
});
