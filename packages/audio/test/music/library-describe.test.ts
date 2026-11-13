// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-B3: `music.findLibraryTrack` 1.1 with `describe`. A version 1 input gives the same bytes as 1.0 did (the 1.0
 * mapping is restated here as the reference); with `describe` the pack's matching tracks and the user's library music
 * are ranked by the searcher, each with genre and mood hints, and without listening it fails plainly.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, newId, NotFoundError, ok, type AssetId, type CommandToolContext } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SoundSearchRequest, SoundSearcher } from '../../src/listen/search/sound-search';
import { loadMusicPack, type MusicPackTrack } from '../../src/music/library-catalogue';
import { libraryMusicFor, type LibraryMusic } from '../../src/music/library-describe';
import { createMusicLibrary, searchTracks, type LibraryQuery } from '../../src/music/library-service';
import { musicLibraryTools, type MusicLibraryToolDeps } from '../../src/tools/music-library-tools';
import { memorySink } from '../helpers/sinks';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-music-describe-'));
  const tracks = [
    { id: 'drive', title: 'Drive', bpm: 120, seconds: 95, moods: ['upbeat'] },
    { id: 'float', title: 'Float', bpm: 80, seconds: 140, moods: ['calm'], attribution: 'A. Composer' },
    { id: 'glow', title: 'Glow', bpm: 122, seconds: 60, moods: ['upbeat', 'calm'] },
  ].map((t) => ({
    ...t,
    file: `${t.id}.mp3`,
    licence: 'CC0-1.0',
    sourceUrl: `https://example.org/${t.id}`,
    dedicationUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  }));
  await writeFile(
    join(dir, 'catalogue.json'),
    JSON.stringify({ version: 1, pack: 'music-pack', packVersion: '1.0.0', tracks }),
  );
  for (const t of tracks) await writeFile(join(dir, t.file), `bytes of ${t.id}`);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ctx = {
  signal: new AbortController().signal,
  callId: newId<'ToolRun'>(),
  attempt: 1,
  artifacts: {
    put: async () => err(NotFoundError({ entity: 'artifact' })),
    get: async () => err(NotFoundError({ entity: 'artifact' })),
  },
  reportUsage: () => undefined,
  reportProgress: () => undefined,
  dispatch: async () => ok(undefined),
} satisfies CommandToolContext;

const mine = (id: string): LibraryMusic => ({
  assetId: id as AssetId,
  title: `${id}.wav`,
  path: `/music/${id}.wav`,
  contentHash: 'a'.repeat(64),
  seconds: 180,
});

function findTool(extra: Partial<MusicLibraryToolDeps> = {}) {
  const [find] = musicLibraryTools({
    library: createMusicLibrary({ pack: { load: () => loadMusicPack(dir) }, sink: memorySink() }),
    readTimeline: async (id) => err(NotFoundError({ entity: 'timeline', id })),
    ...extra,
  });
  if (!find) throw new Error('no tool');
  return find;
}

/** music.findLibraryTrack 1.0's output, as it built it. */
function v1Output(tracks: readonly MusicPackTrack[]) {
  return {
    tracks: tracks.map((track) => ({
      trackId: track.id,
      title: track.title,
      bpm: track.bpm,
      seconds: track.seconds,
      licence: track.licence,
      ...(track.attribution ? { attribution: track.attribution } : {}),
    })),
  };
}

describe('music.findLibraryTrack 1.1', () => {
  it('gives version 1 inputs the same bytes as 1.0', async () => {
    const pack = await loadMusicPack(dir);
    if (!pack.ok) throw new Error(pack.error.code);
    const inputs: Array<{ input: Record<string, unknown>; query: LibraryQuery }> = [
      { input: {}, query: {} },
      { input: { mood: ['calm'] }, query: { moods: ['calm'] } },
      { input: { bpm: 60 }, query: { bpm: 60 } },
      {
        input: { mood: ['upbeat', 'calm'], minSeconds: 70 },
        query: { moods: ['upbeat', 'calm'], minSeconds: 70 },
      },
    ];
    for (const { input, query } of inputs) {
      const out = await findTool().run(input, ctx);
      if (!out.ok) throw new Error(out.error.code);
      expect(JSON.stringify(out.value)).toBe(
        JSON.stringify(v1Output(searchTracks(pack.value.tracks, query))),
      );
    }
  });

  it('ranks the matching pack tracks and the library music by the description, with hints', async () => {
    const asked: SoundSearchRequest[] = [];
    const searcher: SoundSearcher = {
      async search(request) {
        asked.push(request);
        const hit = (id: string, z: number) => ({
          id,
          source: 'entry' as const,
          z,
          cosine: 0.3,
          verdict: z >= 2 ? ('weak' as const) : ('no_match' as const),
          borderline: false,
          nearSilent: false,
          nameScore: 0,
          rankScore: z,
          soundsLike: { term: 'calm and relaxing music', category: 'music_mood' as const, z: 3 },
          hints: {
            music_genre: [{ term: 'lo-fi hip hop beat', z: 2.1 }],
            music_mood: [
              { term: 'calm and relaxing music', z: 3 },
              { term: 'dreamy and ethereal music', z: 2.4 },
              { term: 'warm and cozy music', z: 2 },
            ],
          },
        });
        return ok({
          query: request.query,
          category: 'music_genre',
          hint: true,
          dtype: 'fp16',
          stale: [],
          hits: [hit('asset:lofi', 2.2), hit('pack:float', 1.5)],
        });
      },
    };
    const tool = findTool({ describe: { searcher, library: async () => ok([mine('lofi')]) } });
    const out = await tool.run({ describe: 'calm lo-fi with soft piano', minSeconds: 100 }, ctx);
    if (!out.ok) throw new Error(out.error.code);
    // The length filter keeps one pack track and the library's three-minute track.
    expect(asked[0]?.sounds?.map((s) => s.id)).toEqual(['pack:float', 'asset:lofi']);
    expect(asked[0]?.hints).toEqual(['music_genre', 'music_mood']);
    const tracks = (out.value as { tracks: Array<Record<string, unknown>> }).tracks;
    expect(tracks[0]).toMatchObject({
      trackId: 'lofi',
      source: 'library',
      assetId: 'lofi',
      bpm: null,
      seconds: 180,
      match: { z: 2.2, verdict: 'weak', borderline: false },
      hints: {
        genre: ['lo-fi hip hop beat'],
        mood: ['calm and relaxing music', 'dreamy and ethereal music', 'warm and cozy music'],
      },
    });
    expect(tracks[1]).toMatchObject({
      trackId: 'float',
      source: 'pack',
      licence: 'CC0-1.0',
      attribution: 'A. Composer',
    });
  });

  it('searches the library music with a describe and no filters', async () => {
    let sounds: readonly string[] = [];
    const searcher: SoundSearcher = {
      async search(request) {
        sounds = (request.sounds ?? []).map((s) => s.id);
        return ok({
          query: request.query,
          category: 'everyday',
          hint: false,
          dtype: 'fp16',
          stale: [],
          hits: [],
        });
      },
    };
    const tool = findTool({ describe: { searcher, library: async () => ok([mine('a'), mine('b')]) } });
    expect((await tool.run({ describe: 'a driving beat' }, ctx)).ok).toBe(true);
    expect(sounds).toEqual(['pack:drive', 'pack:float', 'pack:glow', 'asset:a', 'asset:b']);
  });

  it('keys a pack track’s embedding by its file’s sha256, so a changed file is heard again (EAR1-R2)', async () => {
    const keys: string[] = [];
    const searcher: SoundSearcher = {
      async search(request) {
        keys.push(...(request.sounds ?? []).filter((s) => s.id === 'pack:drive').map((s) => s.content));
        const none = { query: request.query, category: 'everyday', hint: false, dtype: 'fp16', stale: [] };
        return ok({ ...none, hits: [] } as never);
      },
    };
    const tool = findTool({ describe: { searcher } });
    expect((await tool.run({ describe: 'a driving beat' }, ctx)).ok).toBe(true);
    await writeFile(join(dir, 'drive.mp3'), 'bytes of a new drive');
    expect((await tool.run({ describe: 'a driving beat' }, ctx)).ok).toBe(true);
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(keys).toEqual([sha('bytes of drive'), sha('bytes of a new drive')]);
  });

  it('fails with audio.listen_unavailable when nothing can listen', async () => {
    const out = await findTool().run({ describe: 'calm piano' }, ctx);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('audio.listen_unavailable');
  });

  it('filters library music by length and tempo while keeping user tracks when moods are passed', () => {
    const music = [mine('a'), { ...mine('b'), seconds: 30 }, { ...mine('c'), bpm: 121 }];
    expect(libraryMusicFor(music, { minSeconds: 60 }).map((m) => m.assetId)).toEqual(['a', 'c']);
    expect(libraryMusicFor(music, { bpm: 120 }).map((m) => m.assetId)).toEqual(['c']);
    expect(libraryMusicFor(music, { moods: ['calm'] }).map((m) => m.assetId)).toEqual(['a', 'b', 'c']);
  });

  it('searches user library tracks with mood + describe when pack is empty, and returns music_library_empty when both are empty', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'taalcut-music-empty-'));
    try {
      await writeFile(
        join(emptyDir, 'catalogue.json'),
        JSON.stringify({ version: 1, pack: 'music-pack', packVersion: '1.0.0', tracks: [] }),
      );
      const emptyLibrary = createMusicLibrary({
        pack: { load: () => loadMusicPack(emptyDir) },
        sink: memorySink(),
      });
      let seenIds: string[] = [];
      const searcher: SoundSearcher = {
        async search(request) {
          seenIds = (request.sounds ?? []).map((s) => s.id);
          return ok({
            query: request.query,
            category: 'music_mood',
            hint: true,
            dtype: 'fp16',
            stale: [],
            hits: [
              {
                id: 'asset:user-calm',
                source: 'entry',
                z: 2.6,
                cosine: 0.35,
                verdict: 'plausible',
                borderline: false,
                nearSilent: false,
                nameScore: 0,
                rankScore: 2.6,
                soundsLike: { term: 'calm and relaxing music', category: 'music_mood' as const, z: 2.8 },
              },
            ],
          });
        },
      };

      const withUserMusic = findTool({
        library: emptyLibrary,
        describe: { searcher, library: async () => ok([mine('user-calm')]) },
      });
      const found = await withUserMusic.run({ mood: ['calm'], describe: 'gentle ambient pad' }, ctx);
      expect(found.ok).toBe(true);
      expect(seenIds).toEqual(['asset:user-calm']);
      if (found.ok) {
        const tracks = (found.value as { tracks: Array<{ assetId?: string; source?: string }> }).tracks;
        expect(tracks).toEqual([expect.objectContaining({ assetId: 'user-calm', source: 'library' })]);
      }

      const bothEmpty = findTool({
        library: emptyLibrary,
        describe: { searcher, library: async () => ok([]) },
      });
      const emptyRes = await bothEmpty.run({ mood: ['calm'], describe: 'gentle ambient pad' }, ctx);
      expect(emptyRes.ok).toBe(false);
      if (!emptyRes.ok) expect(emptyRes.error.code).toBe('audio.music_library_empty');
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
