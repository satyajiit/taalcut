// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1 in the library: a shot's moments are stored with its description, reach casting on the shot's profile with
 * each note's vector, are shown by `library.search` and `library.getAsset` in seconds of the file, and their vectors
 * never take a neighbour's place in a search. MOM2: a stretch the describer stated as the camera being handled keeps
 * that word on the profile and is marked wherever the tools show it.
 */
import {
  newId,
  ok,
  unwrap,
  type AnyTool,
  type CommandToolContext,
  type ShotDescription,
  type ShotId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createShotProfileSource, libraryToolModule } from '../../src/index';
import { shotAnalysis, shotRange } from '../../src/repositories/shots';
import { compactHitsOutput, MAX_INLINE_SEARCH_BYTES } from '../../src/search/compact-hits';
import { storedMoments } from '../../src/search/shot-moments';
import { embedText } from '../fixtures/fake-embedder';
import { searchFixture } from '../search/search-helpers';

const QUERY = 'sunset shots on the beach';

function base() {
  const s = searchFixture();
  const source = createShotProfileSource({ db: s.db, vectors: () => s.vectors });
  const isVideo = (shotId: ShotId) =>
    s.db.driver
      .prepare('SELECT a.kind AS kind FROM shots s JOIN assets a ON a.id = s.asset_id WHERE s.id = ?')
      .get(shotId)?.kind === 'video';
  return { ...s, source, isVideo };
}

/** The fixture with one video shot (the search's first video hit for `QUERY`) ready to be given two moments. */
async function setup() {
  const s = base();
  const hits = unwrap(await s.search.search(QUERY, undefined, 5)).hits;
  const shotId = hits.map((hit) => hit.shot.id).find(s.isVideo)!;
  const source = s.source;
  const shot = unwrap(s.repos.shots.get(shotId));
  const length = shotRange(shot).duration.value;
  const cut = Math.floor(length / 2);
  const description: ShotDescription = {
    ...(shotAnalysis(shot)!.description as ShotDescription),
    moments: [
      { start: 0, end: cut, note: 'The sun sets over the sea.' },
      { start: cut, end: length, note: 'The camera points down at wet sand.' },
    ],
  };
  const describe = () => unwrap(s.repos.shots.putDescriptions([{ shotId, description }]));
  const module = libraryToolModule({
    db: s.db,
    search: s.search,
    importStatus: async () =>
      ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    home: '/Users/me',
  });
  const ctx: CommandToolContext = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async (artifact) =>
        ok({ id: newId<'Artifact'>(), mediaType: artifact.mediaType, bytes: 1, summary: artifact.summary }),
      get: async () => {
        throw new Error('not used');
      },
    },
    reportUsage: () => {},
    reportProgress: () => {},
    dispatch: async () => {
      throw new Error('not used');
    },
  };
  const run = async (name: string, input: unknown) => {
    const tool = module.tools.find((t) => t.name === name)! as AnyTool;
    const output = unwrap(await tool.run(tool.input.parse(input), ctx));
    expect(tool.output.safeParse(output).success, name).toBe(true);
    return output as Record<string, unknown>;
  };
  return { ...s, source, shotId, shot, length, cut, description, describe, module, run };
}

describe('MOM1: moments on a shot’s profile', () => {
  it('are the description’s, in order over the whole shot, each with its note’s vector once embedded', async () => {
    const s = await setup();
    const before = unwrap(await s.source.profiles([{ assetId: '', shotId: s.shotId }]))[0]!;
    // Described before MOM1: no moments, and nothing else about the profile changes with them.
    expect(before.moments).toBeNull();
    s.describe();
    const vector = embedText('wet sand');
    unwrap(
      s.vectors.upsert([
        { id: `moment:${s.shotId}:1`, vector, metadata: { assetId: s.shot.assetId, kind: 'moment' } },
      ]),
    );
    const profile = unwrap(await s.source.profiles([{ assetId: '', shotId: s.shotId }]))[0]!;
    expect(profile.moments).toHaveLength(2);
    expect(profile.moments![0]).toEqual({
      start: 0,
      end: s.cut,
      note: 'The sun sets over the sea.',
      // Not embedded yet: casting leaves a stretch without a vector out of its fit.
      vector: null,
    });
    expect(profile.moments![1]).toMatchObject({ start: s.cut, end: s.length });
    expect([...profile.moments![1]!.vector!]).toEqual([...vector].map((x) => expect.closeTo(x, 5)));
    expect(profile.embedding).toEqual(before.embedding);
    expect(profile.description).toBe(before.description);
  });

  it('are put on the profile’s own frame grid when they were written on another', async () => {
    const s = await setup();
    // Written on a grid twice as fine as the shot's range (a file whose stated rate differs from its shots').
    const fine: ShotDescription = {
      ...s.description,
      moments: [
        { start: 0, end: s.cut * 2, note: 'A' },
        { start: s.cut * 2, end: s.length * 2, note: 'B' },
      ],
    };
    unwrap(s.repos.shots.putDescriptions([{ shotId: s.shotId, description: fine }]));
    const profile = unwrap(await s.source.profiles([{ assetId: '', shotId: s.shotId }]))[0]!;
    expect(profile.moments!.map((m) => [m.start, m.end])).toEqual([
      [0, s.cut],
      [s.cut, s.length],
    ]);
  });

  it('never reach a photo’s profile', async () => {
    const s = await setup();
    const photos = unwrap(await s.source.list({}, 10_000)).filter((p) => p.kind === 'image');
    expect(photos.length).toBeGreaterThan(0);
    expect(photos.every((p) => p.moments === null)).toBe(true);
  });
});

describe('MOM1: moment vectors and search', () => {
  it('take no neighbour’s place: a search ranks exactly what it ranked before them', async () => {
    const s = await setup();
    const query = QUERY;
    const before = unwrap(await s.search.search(query, undefined, 30)).hits.map((h) => [h.shot.id, h.score]);
    // Hundreds of moment vectors right on the query, on shots of another theme.
    const others = s.fixture.shotsByTheme.get('street-market') ?? [...s.fixture.shotsByTheme.values()][3]!;
    const vector = embedText(query);
    unwrap(
      s.vectors.upsert(
        others.flatMap((shotId) =>
          Array.from({ length: 12 }, (_, n) => ({
            id: `moment:${shotId}:${n}`,
            vector,
            metadata: { assetId: unwrap(s.repos.shots.get(shotId)).assetId, kind: 'moment' },
          })),
        ),
      ),
    );
    const after = unwrap(await s.search.search(query, undefined, 30)).hits.map((h) => [h.shot.id, h.score]);
    expect(after).toEqual(before);
  });
});

describe('MOM1: what the library tools show', () => {
  it('reads stored moments with the shot’s start in its file, and skips shots without any', async () => {
    const s = await setup();
    expect(storedMoments(s.db, [s.shotId]).size).toBe(0);
    s.describe();
    const other = s.fixture.shotsByTheme.get('beach-sunset')!.find((id) => id !== s.shotId)!;
    const stored = storedMoments(s.db, [s.shotId, other, s.shotId]);
    expect([...stored.keys()]).toEqual([s.shotId]);
    const range = shotRange(s.shot);
    expect(stored.get(s.shotId)).toMatchObject({
      moments: s.description.moments,
      offsetSeconds: (range.start.value * range.start.rate.den) / range.start.rate.num,
    });
    expect(stored.get(s.shotId)!.fps).toBeCloseTo(range.duration.rate.num / range.duration.rate.den, 6);
  });

  it('library.search and library.getAsset say what a shot shows from when to when, marked as media', async () => {
    const s = await setup();
    s.describe();
    const found = await s.run('library.search', { query: QUERY, limit: 5 });
    const hit = (found.hits as { shotId: string; moments?: string }[]).find((h) => h.shotId === s.shotId)!;
    expect(hit.moments).toMatch(
      /^[\d.]+-[\d.]+s: The sun sets over the sea\.; [\d.]+-[\d.]+s: The camera points down at wet sand\.$/,
    );
    const others = (found.hits as { shotId: string; moments?: string }[]).filter(
      (h) => h.shotId !== s.shotId,
    );
    expect(others.every((h) => h.moments === undefined)).toBe(true);

    const asset = await s.run('library.getAsset', { assetId: s.shot.assetId, include: ['shots'] });
    const shots = asset.shots as { shotId: string; moments: string | null }[];
    expect(shots.find((shot) => shot.shotId === s.shotId)!.moments).toBe(hit.moments);
    expect(shots.filter((shot) => shot.shotId !== s.shotId).every((shot) => shot.moments === null)).toBe(
      true,
    );

    // A shot of one moment: the hit's sentence says it already, so the hit shows none; the asset's detail does.
    const whole = {
      ...s.description,
      moments: [{ start: 0, end: s.length, note: 'The sun sets over the sea.' }],
    };
    unwrap(s.repos.shots.putDescriptions([{ shotId: s.shotId, description: whole }]));
    const again = await s.run('library.search', { query: QUERY, limit: 5 });
    expect((again.hits as { moments?: string }[]).every((h) => h.moments === undefined)).toBe(true);
    const detail = await s.run('library.getAsset', { assetId: s.shot.assetId, include: ['shots'] });
    expect(
      (detail.shots as { shotId: string; moments: string | null }[]).find((shot) => shot.shotId === s.shotId)!
        .moments,
    ).toMatch(/^[\d.]+-[\d.]+s: The sun sets over the sea\.$/);

    for (const name of ['library.search', 'library.getAsset']) {
      const tool = s.module.tools.find((t) => t.name === name)! as AnyTool;
      const schema = JSON.stringify(z.toJSONSchema(tool.output, { target: 'draft-2020-12', io: 'output' }));
      expect(schema).toMatch(/"moments":\{[^}]*"untrusted":"media"/);
    }
  });

  it('drops the moments first when a long list of hits must fit inline', () => {
    const hit = (n: number) => ({
      shotId: newId<'Shot'>(),
      assetId: newId<'Asset'>(),
      fileName: `clip-${n}.mov`,
      start: { value: 0, rate: { num: 30, den: 1 } },
      duration: { value: 150, rate: { num: 30, den: 1 } },
      description: 'A short description.',
      moments: `0-2.5s: ${'a'.repeat(70)}; 2.5-5s: ${'b'.repeat(70)}; 5-7s: ${'c'.repeat(70)}`,
      matchedBy: ['visual' as const],
      score: 0.5,
    });
    const few = { hits: Array.from({ length: 5 }, (_, n) => hit(n)) };
    expect(compactHitsOutput(few)).toEqual(few);
    const many = { hits: Array.from({ length: 30 }, (_, n) => hit(n)) };
    const compact = compactHitsOutput(many);
    expect(Buffer.byteLength(JSON.stringify(compact), 'utf8')).toBeLessThanOrEqual(MAX_INLINE_SEARCH_BYTES);
    expect(compact.hits.every((h) => h.moments === undefined)).toBe(true);
    // Nothing else was cut: the description is whole.
    expect(compact.hits.every((h) => h.description === 'A short description.')).toBe(true);
  });
});

describe('MOM2: a stretch where the camera is being handled', () => {
  /** The shot's second half stated as handling, as vision's describe stage stores it. */
  const lowered = (s: Awaited<ReturnType<typeof setup>>, whole = false): ShotDescription => ({
    ...s.description,
    moments: whole
      ? [{ start: 0, end: s.length, note: 'A hand covers the lens.', handling: true }]
      : [
          { start: 0, end: s.cut, note: 'The sun sets over the sea.' },
          { start: s.cut, end: s.length, note: 'The camera points down at wet sand.', handling: true },
        ],
  });
  const put = (s: Awaited<ReturnType<typeof setup>>, description: ShotDescription) =>
    unwrap(s.repos.shots.putDescriptions([{ shotId: s.shotId, description }]));
  const momentsOf = async (s: Awaited<ReturnType<typeof setup>>) =>
    unwrap(await s.source.profiles([{ assetId: '', shotId: s.shotId }]))[0]!.moments!;

  it('keeps the describer’s word on the profile, and none on a row written before it', async () => {
    const s = await setup();
    put(s, lowered(s));
    expect((await momentsOf(s)).map((moment) => moment.handling)).toEqual([undefined, true]);
    expect(storedMoments(s.db, [s.shotId]).get(s.shotId)!.moments[1]).toMatchObject({ handling: true });
    // A MOM1-shaped row parses as it did: no stretch of it is handling.
    s.describe();
    expect((await momentsOf(s)).some((moment) => 'handling' in moment)).toBe(false);
  });

  it('is marked in library.search and library.getAsset, also when it is the whole shot', async () => {
    const s = await setup();
    put(s, lowered(s));
    const hitOf = async () => {
      const found = await s.run('library.search', { query: QUERY, limit: 5 });
      return (found.hits as { shotId: string; moments?: string }[]).find((h) => h.shotId === s.shotId)!;
    };
    expect((await hitOf()).moments).toMatch(
      /^[\d.]+-[\d.]+s: The sun sets over the sea\.; [\d.]+-[\d.]+s \(camera handling\): The camera points down at wet sand\.$/,
    );
    const asset = await s.run('library.getAsset', { assetId: s.shot.assetId, include: ['shots'] });
    const shown = (asset.shots as { shotId: string; moments: string | null }[]).find(
      (shot) => shot.shotId === s.shotId,
    )!;
    expect(shown.moments).toContain('s (camera handling): The camera points down at wet sand.');
    // One moment says what the hit's sentence says, unless it is handling: the sentence does not say that.
    put(s, lowered(s, true));
    expect((await hitOf()).moments).toMatch(/^[\d.]+-[\d.]+s \(camera handling\): A hand covers the lens\.$/);
    for (const name of ['library.search', 'library.getAsset']) {
      const tool = s.module.tools.find((t) => t.name === name)! as AnyTool;
      expect(tool.description).toContain('(camera handling)');
    }
  });
});
