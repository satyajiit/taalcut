// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetProvenanceSchema, MUSIC_COMMANDS, musicCommandPayloads, ok } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMusicPack, type MusicPackTrack } from '../../src/music/library-catalogue';
import { createMusicLibrary, searchTracks, tempoDistance } from '../../src/music/library-service';
import { memorySink } from '../helpers/sinks';
import { makeTestTimeline, steadyBeatMap } from '../helpers/timeline';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-music-pack-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function track(id: string, bpm: number, moods: string[], seconds = 60, file = `${id}.mp3`): MusicPackTrack {
  return {
    id,
    title: `Track ${id}`,
    file,
    bpm,
    seconds,
    moods,
    licence: 'CC0-1.0',
    sourceUrl: `https://example.org/${id}`,
    dedicationUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  };
}

async function writeCatalogue(tracks: readonly object[]) {
  await writeFile(
    join(dir, 'catalogue.json'),
    JSON.stringify({ version: 1, pack: 'music-pack', packVersion: '1.0.0', tracks }),
  );
}

async function writePack(tracks: readonly MusicPackTrack[], bytes = true) {
  await writeCatalogue(tracks);
  if (bytes) for (const t of tracks) await writeFile(join(dir, t.file), `bytes of ${t.id}`);
}

const fromDir = () => ({ load: () => loadMusicPack(dir) });

describe('the music pack catalogue', () => {
  it('loads a valid pack and resolves each file inside the pack folder', async () => {
    await writePack([track('calm-one', 96, ['calm'])]);
    const pack = await loadMusicPack(dir);
    if (!pack.ok) throw new Error(pack.error.code);
    const [only] = pack.value.tracks;
    expect(only?.id).toBe('calm-one');
    expect(only && pack.value.pathOf(only)).toBe(join(dir, 'calm-one.mp3'));
  });

  it('is empty (audio.music_library_empty) when missing, not JSON, invalid, empty or with an id twice', async () => {
    const codes: string[] = [];
    const code = async () => {
      const loaded = await loadMusicPack(dir);
      codes.push(loaded.ok ? 'ok' : loaded.error.code);
    };
    await code();
    await writeFile(join(dir, 'catalogue.json'), '{ not json');
    await code();
    await writeCatalogue([{ ...track('bad', 96, []), licence: 'CC-BY-4.0' }]);
    await code();
    await writePack([]);
    await code();
    await writePack([track('twice', 96, []), track('twice', 100, [])]);
    await code();
    expect(codes).toEqual(Array(5).fill('audio.music_library_empty'));
  });

  it('refuses a file name with a folder in it', async () => {
    await writeCatalogue([track('escape', 96, [], 60, '../escape.mp3')]);
    const loaded = await loadMusicPack(dir);
    expect(loaded.ok ? 'ok' : loaded.error.code).toBe('audio.music_library_empty');
  });
});

describe('searching the pack', () => {
  const tracks = [
    track('a-120', 120, ['upbeat', 'bright']),
    track('b-126', 126, ['upbeat']),
    track('c-128', 128, ['upbeat']),
    track('d-60', 60, ['calm']),
    track('e-90', 90, ['calm', 'warm'], 20),
  ];

  it('matches tempo within 6 %, or its half or double', () => {
    expect(tempoDistance(126, 120)).toBeCloseTo(0.05);
    expect(tempoDistance(128, 120)).toBeNull();
    expect(tempoDistance(60, 120)).toBe(0);
    expect(tempoDistance(240, 120)).toBe(0);
    expect(searchTracks(tracks, { bpm: 120 }).map((t) => t.id)).toEqual(['a-120', 'd-60', 'b-126']);
  });

  it('ranks by mood words matched, then tempo, and drops tracks with none of the moods', () => {
    expect(searchTracks(tracks, { moods: ['bright', 'upbeat'] }).map((t) => t.id)).toEqual([
      'a-120',
      'b-126',
      'c-128',
    ]);
    expect(searchTracks(tracks, { moods: ['calm'], bpm: 90 }).map((t) => t.id)).toEqual(['e-90']);
  });

  it('keeps tracks at least minSeconds long and returns at most 10', () => {
    expect(searchTracks(tracks, { minSeconds: 30 }).map((t) => t.id)).not.toContain('e-90');
    const many = Array.from({ length: 14 }, (_, i) => track(`t-${String(i).padStart(2, '0')}`, 100, []));
    expect(searchTracks(many, {})).toHaveLength(10);
  });
});

describe('createMusicLibrary', () => {
  const timeline = makeTestTimeline({ clips: [{ frames: 300 }], beatMap: steadyBeatMap(120, 12) });

  it('finds nothing in an empty pack with audio.music_library_empty, and [] for no match', async () => {
    const library = createMusicLibrary({ pack: fromDir(), sink: memorySink() });
    const empty = await library.find({});
    expect(empty.ok ? 'ok' : empty.error.code).toBe('audio.music_library_empty');
    await writePack([track('calm-one', 96, ['calm'])]);
    expect(await library.find({ moods: ['angry'] })).toEqual(ok([]));
  });

  it('adds the track byte for byte as a bundled CC0 asset and returns the ownTrack choice', async () => {
    const beatMap = steadyBeatMap(96, 30);
    await writePack([{ ...track('calm-one', 96, ['calm'], 60, 'calm-one.opus'), beatMap }]);
    const sink = memorySink();
    const library = createMusicLibrary({ pack: fromDir(), sink });
    const used = await library.use({ timeline, trackId: 'calm-one' });
    if (!used.ok) throw new Error(used.error.code);
    const [stored] = [...sink.files.values()];
    if (!stored) throw new Error('nothing stored');
    expect(Buffer.from(stored.bytes).toString()).toBe('bytes of calm-one');
    expect(stored).toMatchObject({
      mediaType: 'audio/ogg',
      fileName: 'music-calm-one.opus',
      projectId: null,
    });
    expect(assetProvenanceSchema.parse(stored.provenance)).toEqual({
      kind: 'bundled',
      pack: 'music-pack',
      itemId: 'calm-one',
      licence: 'CC0-1.0',
      sourceUrl: 'https://example.org/calm-one',
      title: 'Track calm-one',
    });
    const payload = musicCommandPayloads[MUSIC_COMMANDS.choosePath].parse(used.value.payload);
    expect(payload).toMatchObject({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      choice: { path: 'ownTrack', assetId: used.value.assetId, gainDb: 0 },
    });
    expect(payload.choice.path === 'ownTrack' && payload.choice.offset.value).toBe(0);
    expect(used.value.beatMap).toEqual(beatMap);
    expect(used.value.duplicate).toBe(false);
    const again = await library.use({ timeline, trackId: 'calm-one' });
    expect(again.ok && again.value).toMatchObject({ assetId: used.value.assetId, duplicate: true });
  });

  it('names an unknown track, and a track whose file is gone empties the library', async () => {
    await writePack([track('calm-one', 96, ['calm'])], false);
    const library = createMusicLibrary({ pack: fromDir(), sink: memorySink() });
    const unknown = await library.use({ timeline, trackId: 'nope' });
    expect(unknown.ok ? 'ok' : [unknown.error.code, unknown.error.params]).toEqual([
      'audio.music_track_unknown',
      { trackId: 'nope' },
    ]);
    const gone = await library.use({ timeline, trackId: 'calm-one' });
    expect(gone.ok ? 'ok' : gone.error.code).toBe('audio.music_library_empty');
  });
});
