// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L12 "Done when": each tool has its schema, cost class and metadata, and "sunset shots on the
 * beach" finds the beach sunsets in the fixture library (fake embedder; the real sample libraries run
 * in P2-Q1).
 */
import {
  newId,
  ok,
  parseCard,
  toolModuleProblems,
  unwrap,
  type AnyTool,
  type ArtifactInput,
  type CommandToolContext,
  type ImportStatus,
  type IndexingStatus,
  type SourceId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { folderKey, libraryToolModule } from '../../src/index';
import { shotRange } from '../../src/repositories/shots';
import { LANGUAGES, THEMES } from '../fixtures/library-themes';
import { analysisFor } from '../repositories/profile-helpers';
import { searchFixture } from '../search/search-helpers';

const counts = { assets: 10, done: 4, active: 2, waiting: 3, failed: 1, searchable: 6 };
function importOf(sourceId: SourceId): ImportStatus {
  const stages = [{ stage: 'vision.analyse', done: 4, left: 6, failed: 1, milestone: 'searchable' as const }];
  return { sourceId, state: 'indexing', counts, stages, etaMs: 60_000, jobIds: [], updatedAt: 1 };
}

function setup() {
  const s = searchFixture();
  const status: IndexingStatus = {
    paused: false,
    overall: counts,
    sources: s.fixture.sources.slice(0, 2).map(importOf),
    etaMs: 60_000,
    updatedAt: 1,
  };
  const stored: ArtifactInput[] = [];
  const dispatched: unknown[] = [];
  const module = libraryToolModule({
    db: s.db,
    search: s.search,
    importStatus: async () => ok(status),
    home: '/Users/me',
  });
  const tool = (name: string) => module.tools.find((t) => t.name === name)! as AnyTool;
  const ctx: CommandToolContext = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async (artifact) => {
        stored.push(artifact);
        return ok({
          id: newId<'Artifact'>(),
          mediaType: artifact.mediaType,
          bytes: 1,
          summary: artifact.summary,
        });
      },
      get: async () => {
        throw new Error('not used');
      },
    },
    reportUsage: () => {},
    reportProgress: () => {},
    dispatch: async (payload) => {
      dispatched.push(payload);
      const source = {
        id: newId<'Source'>(),
        name: 'Trip',
        path: '/Users/me/Trip',
        kind: 'watched_folder',
        status: 'online',
      };
      return ok({ ...source, scan: { jobId: newId<'Job'>() } });
    },
  };
  const run = async (name: string, input: unknown) => {
    const t = tool(name);
    const output = unwrap(await t.run(t.input.parse(input), ctx));
    expect(t.output.safeParse(output).success, name).toBe(true);
    return output as Record<string, unknown>;
  };
  const cardCtx = { runId: ctx.runId!, toolCallId: ctx.callId, projectId: null, signal: ctx.signal };
  return { ...s, module, tool, run, stored, dispatched, cardCtx };
}

describe('library tools: metadata', () => {
  it('declare everything the registry checks, at the SPEC versions, local and offline', () => {
    const t = setup();
    expect(toolModuleProblems(t.module)).toEqual([]);
    const meta = Object.fromEntries(
      t.module.tools.map((x) => [
        x.name,
        [x.version, x.sideEffect, x.timeoutMs, x.retry.maxAttempts, x.costClass],
      ]),
    );
    expect(meta).toEqual({
      'library.search': ['1.1.0', 'read', 30_000, 2, 'local'],
      'library.findSimilar': ['1.1.0', 'read', 10_000, 1, 'local'],
      'library.getAsset': ['1.1.0', 'read', 5_000, 1, 'local'],
      'library.importStatus': ['1.1.0', 'read', 5_000, 1, 'local'],
      'library.addSource': ['1.1.0', 'write', 10_000, 1, 'local'],
      'library.listSources': ['1.1.0', 'read', 5_000, 1, 'local'],
      'library.listFiles': ['1.0.0', 'read', 10_000, 1, 'local'],
    });
    expect(t.module.tools.every((x) => x.permission?.network === 'none')).toBe(true);
    expect(t.tool('library.search').retry.initialDelayMs).toBe(1_000);
    // What the disk or a model wrote is marked untrusted in the schema the model sees.
    const schema = JSON.stringify(z.toJSONSchema(t.tool('library.search').output, { io: 'input' }));
    expect(schema).toContain('"untrusted":"file-system"');
    expect(schema).toContain('"untrusted":"media"');
  });
});

describe('library tools: JSON Schema for the model', () => {
  it('export every input and output the way the tool registry does (nothing unrepresentable)', () => {
    const t = setup();
    expect(t.module.tools).toHaveLength(7);
    for (const tool of t.module.tools) {
      for (const [io, schema] of [
        ['input', tool.input],
        ['output', tool.output],
      ] as const) {
        expect(
          () => z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'throw' }),
          `${tool.name} ${io}`,
        ).not.toThrow();
      }
    }
  });

  it('check ids and times again at the boundary', async () => {
    const t = setup();
    const search = t.tool('library.search');
    const badTime = { query: 'sunset', filters: { minDuration: { value: 1, rate: { num: 0, den: 1 } } } };
    expect(search.input.safeParse(badTime).success).toBe(false);
    const badSource = {
      query: 'sunset',
      filters: { sourceIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'.toLowerCase()] },
    };
    expect(search.input.safeParse(badSource).success).toBe(false);
    const asset = await t.tool('library.getAsset').run({ assetId: '0'.repeat(26), include: [] }, {} as never);
    expect(!asset.ok && asset.error.code).toBe('core.not_found');
  });
});

describe('library.search', () => {
  it('finds sunset shots on the beach, in every language', async () => {
    const t = setup();
    const theme = THEMES.find((x) => x.key === 'beach-sunset')!;
    for (const language of LANGUAGES) {
      const { hits } = (await t.run('library.search', { query: theme.queries[language] })) as {
        hits: { shotId: never; fileName: string; matchedBy: string[] }[];
      };
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.length).toBeLessThanOrEqual(12);
      expect(hits.slice(0, 5).map((h) => t.themeOfShot(h.shotId))).toEqual(Array(5).fill('beach-sunset'));
      expect(hits[0]!.fileName).toMatch(/^beach-sunset-/);
    }
  });
});

describe('library.search by what people are doing (LIB1-FIND)', () => {
  it('filters by actions and says each hit’s actions; getAsset lists them per shot', async () => {
    const t = setup();
    // A best take (search keeps one shot per near-duplicate group).
    const [dancing] = t.fixture.shotsByTheme
      .get('beach-sunset')!
      .filter((id) => unwrap(t.repos.shots.get(id)).bestTake);
    // Described as vision.describe stores it: inside the shot's analysis.
    const shot = unwrap(t.repos.shots.get(dancing!));
    const base = analysisFor(shotRange(shot));
    const description = {
      ...base.description!,
      text: 'Two people on the sand.',
      actions: ['dancing', 'laughing'],
    };
    unwrap(t.repos.shots.putAnalyses([{ shotId: dancing!, analysis: { ...base, description } }]));
    const theme = THEMES.find((x) => x.key === 'beach-sunset')!;
    // "dance" finds it by its stored action alone: its words never say so.
    const { hits } = (await t.run('library.search', {
      query: 'dance',
      filters: { actions: ['dancing'] },
    })) as { hits: { shotId: string; actions: string[]; place: unknown; trip: unknown }[] };
    expect(hits.map((h) => h.shotId)).toEqual([dancing]);
    expect(hits[0]!.actions).toEqual(['dancing', 'laughing']);
    // No place stored for it here: place and trip say so (place's own tests store one).
    expect(hits[0]).toMatchObject({ place: null, trip: null });
    const all = (await t.run('library.search', { query: theme.queries.en })) as {
      hits: { shotId: string; actions: string[] }[];
    };
    // Shots described before LIB1 carry none.
    expect(all.hits.length).toBeGreaterThan(0);
    for (const hit of all.hits.filter((h) => h.shotId !== dancing)) expect(hit.actions).toEqual([]);

    const assetId = unwrap(t.repos.shots.get(dancing!)).assetId;
    const output = await t.run('library.getAsset', { assetId, include: ['shots'] });
    const shots = output.shots as { shotId: string; actions: string[] }[];
    expect(shots.find((s) => s.shotId === dancing)?.actions).toEqual(['dancing', 'laughing']);
    expect(output.asset).toMatchObject({ place: null, trip: null });
    const schema = JSON.stringify(z.toJSONSchema(t.tool('library.search').input));
    expect(schema).toContain('dancing, walking, running');
  });

  it('says where a hit’s clip was filmed and its trip, by name only, and filters by them', async () => {
    const t = setup();
    const [shotId] = t.fixture.shotsByTheme
      .get('beach-sunset')!
      .filter((id) => unwrap(t.repos.shots.get(id)).bestTake);
    const assetId = unwrap(t.repos.shots.get(shotId!)).assetId;
    // As place's refresh stores them (src/places/refresh.ts): a gps place in Lisbon, in a trip the person named.
    const trip = newId<'Trip'>();
    t.db.driver
      .prepare(
        `INSERT INTO trips (id, name, month, started_at, ended_at, clips, days, created_at, updated_at)
         VALUES (?, 'Beach week', '2026-03', 1, 2, 1, 1, 1, 1)`,
      )
      .run(trip);
    const place = { basis: 'gps', cityId: 2267057, city: 'Lisbon', region: 'Lisbon', country: 'PT', km: 0 };
    t.db.driver
      .prepare(
        `INSERT INTO asset_places (asset_id, place, basis, country, city_id, trip_id, search_text, updated_at)
         VALUES (?, ?, 'gps', 'PT', 2267057, ?, 'Lisbon Portugal', 1)`,
      )
      .run(assetId, JSON.stringify(place), trip);
    const theme = THEMES.find((x) => x.key === 'beach-sunset')!;
    const { hits } = (await t.run('library.search', {
      query: theme.queries.en,
      filters: { tripIds: [trip], countries: ['PT'], cityIds: [2267057] },
    })) as { hits: { shotId: string; assetId: string; place: string | null; trip: unknown }[] };
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.assetId).toBe(assetId);
    expect(hits[0]!.place).toMatch(/Lisbon/);
    expect(hits[0]!.trip).toEqual({ id: trip, name: 'Beach week', month: '2026-03' });
    const none = (await t.run('library.search', {
      query: theme.queries.en,
      filters: { countries: ['BR'] },
    })) as { hits: unknown[] };
    expect(none.hits).toEqual([]);

    const output = await t.run('library.getAsset', { assetId });
    expect(output.asset).toMatchObject({
      place: { basis: 'gps', country: 'PT', cityId: 2267057 },
      trip: { id: trip, name: 'Beach week', month: '2026-03' },
    });
    expect((output.asset as { place: { words: string } }).place.words).toMatch(/Lisbon/);
    // No coordinates anywhere in what the agent reads.
    expect(JSON.stringify(output)).not.toMatch(/latitude|longitude|"lat"|"lon"/);
  });
});

describe('library.findSimilar', () => {
  it('takes a shot or an asset (its best first shot), not both', async () => {
    const t = setup();
    const shotId = t.fixture.shotsByTheme.get('dog-park')![0]!;
    const assetId = unwrap(t.repos.shots.get(shotId)).assetId;
    const byShot = (await t.run('library.findSimilar', { shotId })) as { hits: { shotId: never }[] };
    expect(t.themeOfShot(byShot.hits[0]!.shotId)).toBe('dog-park');
    const byAsset = (await t.run('library.findSimilar', { assetId })) as { hits: unknown[] };
    expect(byAsset.hits.length).toBeGreaterThan(0);
    const tool = t.tool('library.findSimilar');
    expect(tool.input.safeParse({ shotId, assetId }).success).toBe(false);
    expect(tool.input.safeParse({}).success).toBe(false);
  });
});

describe('library.getAsset', () => {
  it('returns facts, shots and transcript without the capture place', async () => {
    const t = setup();
    const assetId = t.fixture.assets.find((id) => unwrap(t.repos.assets.get(id)).kind === 'video')!;
    const facts = t.repos.assets.facts(unwrap(t.repos.assets.get(assetId)))!;
    unwrap(t.repos.assets.setFacts(assetId, { ...facts, location: { latitude: 15.55, longitude: 73.75 } }));
    const output = await t.run('library.getAsset', {
      assetId,
      include: ['shots', 'transcript', 'locations'],
    });
    const text = JSON.stringify(output);
    expect(text).not.toMatch(/15\.55|73\.75|latitude|longitude|iPhone 17/);
    expect((output.shots as unknown[]).length).toBeGreaterThan(0);
    expect(output.transcript).toMatchObject({ truncated: false });
    expect(output.locations).toEqual([expect.objectContaining({ storage: expect.any(String) })]);
  });

  it('keeps a long transcript in an artifact', async () => {
    const t = setup();
    const assetId = t.fixture.assets.find((id) => t.repos.transcripts.get(id))!;
    const transcript = t.repos.transcripts.get(assetId)!;
    const segments = Array.from({ length: 40 }, () => transcript.segments[0]!);
    unwrap(t.repos.transcripts.put(assetId, { ...transcript, segments }, 0));
    const output = await t.run('library.getAsset', { assetId, include: ['transcript'] });
    expect(output.shots).toBeUndefined();
    expect(output.transcript).toMatchObject({ truncated: true, artifact: { mediaType: 'text/plain' } });
    expect((output.transcript as { lines: unknown[] }).lines).toHaveLength(20);
    expect(t.stored[0]!.data.toString().split('\n')).toHaveLength(40);
  });
});

describe('library.importStatus', () => {
  it('reports one source as an import progress card with its newest thumbnails', async () => {
    const t = setup();
    const sourceId = t.fixture.sources[1]!;
    const tool = t.tool('library.importStatus');
    const output = (await t.run('library.importStatus', { sourceId })) as IndexingStatus;
    expect(output.sources.map((s) => s.sourceId)).toEqual([sourceId]);
    // 1.1.0 (round IX): how many search finds already, and each stage's finish line, reach the model and the card.
    expect(output.sources[0]?.counts.searchable).toBe(counts.searchable);
    expect(output.sources[0]?.stages[0]?.milestone).toBe('searchable');
    const card = unwrap(await tool.resultCard!(output, t.cardCtx))!;
    expect(parseCard(card).ok).toBe(true);
    expect(card).toMatchObject({
      type: 'importProgress',
      id: `importProgress:${sourceId}`,
      sourceId,
      status: { counts: { searchable: counts.searchable }, stages: [{ milestone: 'searchable' }] },
    });
    expect((card as { thumbnails: unknown[] }).thumbnails).toHaveLength(8);
    // Two sources and none asked for: no single card to show.
    const all = (await t.run('library.importStatus', {})) as IndexingStatus;
    expect(unwrap(await tool.resultCard!(all, t.cardCtx))).toBeUndefined();
  });
});

describe('library.addSource 1.1.0', () => {
  it('passes watch on, returns the scan job and keys the same folder alike', async () => {
    const t = setup();
    const output = await t.run('library.addSource', { path: '~/Trip', watch: false });
    expect(t.dispatched).toEqual([{ path: '/Users/me/Trip', watch: false }]);
    expect(output.scan).toEqual({ jobId: expect.any(String) });
    const key = t.tool('library.addSource').idempotencyKey!;
    expect(key({ path: '~/Trip' })).toBe(key({ path: '/Users/me/./Trip/' }));
    expect(folderKey('/a/b')).not.toBe(folderKey('/a/c'));
  });
});
