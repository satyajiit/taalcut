// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineToolModule,
  err,
  MUSIC_COMMANDS,
  musicCommandPayloads,
  newId,
  NotFoundError,
  ok,
  toolModuleProblems,
  type AnyTool,
  type CommandToolContext,
  type Timeline,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMusicPack } from '../../src/music/library-catalogue';
import { createMusicLibrary } from '../../src/music/library-service';
import { musicLibraryTools } from '../../src/tools/music-library-tools';
import { memorySink } from '../helpers/sinks';
import { makeTestTimeline } from '../helpers/timeline';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-music-tools-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePack() {
  const tracks = [
    { id: 'drive', title: 'Drive', bpm: 120, seconds: 95, moods: ['upbeat'] },
    { id: 'float', title: 'Float', bpm: 80, seconds: 140, moods: ['calm'], attribution: 'A. Composer' },
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
}

function setup(timeline: Timeline) {
  const dispatched: unknown[] = [];
  const tools = musicLibraryTools({
    library: createMusicLibrary({ pack: { load: () => loadMusicPack(dir) }, sink: memorySink() }),
    readTimeline: async (id) =>
      id === timeline.id ? ok(timeline) : err(NotFoundError({ entity: 'timeline', id })),
  });
  const ctx: CommandToolContext = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: {
      put: async () => err(NotFoundError({ entity: 'artifact' })),
      get: async () => err(NotFoundError({ entity: 'artifact' })),
    },
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch: async (payload) => {
      dispatched.push(payload);
      return ok({ timelineId: timeline.id, revision: timeline.revision + 1 });
    },
  };
  const tool = (name: string): AnyTool => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`missing ${name}`);
    return found;
  };
  return { tools, ctx, dispatched, tool };
}

describe('music pack tools (SPEC P3.9)', () => {
  const timeline = makeTestTimeline({ clips: [{ frames: 300 }] });

  it('declare full metadata and register as part of the music module', () => {
    const { tools } = setup(timeline);
    expect(toolModuleProblems(defineToolModule({ id: 'music', tools }))).toEqual([]);
    const [find, use] = tools;
    expect(find).toMatchObject({
      name: 'music.findLibraryTrack',
      // EAR1-B3: `describe` is a minor bump; listening needs the longer timeout.
      version: '1.1.0',
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 120_000,
      retry: { maxAttempts: 2 },
      // EAR1-R2: no tool-layer cache: its key can't see the library's music or the model build.
      cache: false,
      permission: { network: 'none' },
    });
    expect(use).toMatchObject({
      name: 'music.useLibraryTrack',
      costClass: 'local',
      sideEffect: 'write',
      command: MUSIC_COMMANDS.choosePath,
      timeoutMs: 30_000,
      retry: { maxAttempts: 1 },
    });
  });

  it('findLibraryTrack lists matching tracks with their licence and any credit', async () => {
    await writePack();
    const { tool, ctx } = setup(timeline);
    const found = await tool('music.findLibraryTrack').run({ mood: ['calm'] }, ctx);
    expect(found).toEqual(
      ok({
        tracks: [
          {
            trackId: 'float',
            title: 'Float',
            bpm: 80,
            seconds: 140,
            licence: 'CC0-1.0',
            attribution: 'A. Composer',
          },
        ],
      }),
    );
  });

  it('useLibraryTrack dispatches music.choosePath for the added asset and reports the choice', async () => {
    await writePack();
    const { tool, ctx, dispatched } = setup(timeline);
    const input = { projectId: timeline.projectId, timelineId: timeline.id, trackId: 'drive' };
    const used = await tool('music.useLibraryTrack').run(input, ctx);
    if (!used.ok) throw new Error(used.error.code);
    expect(dispatched).toHaveLength(1);
    const payload = musicCommandPayloads[MUSIC_COMMANDS.choosePath].parse(dispatched[0]);
    expect(payload.choice).toMatchObject({ path: 'ownTrack', gainDb: 0 });
    expect(used.value).toMatchObject({
      path: 'ownTrack',
      trackId: 'drive',
      title: 'Drive',
      licence: 'CC0-1.0',
      sourceUrl: 'https://example.org/drive',
      assetId: payload.choice.path === 'ownTrack' ? payload.choice.assetId : null,
    });
  });

  it('refuses a stale revision without dispatching, and keys repeats on the revision', async () => {
    await writePack();
    const { tool, ctx, dispatched } = setup(timeline);
    const input = {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      trackId: 'drive',
      revision: timeline.revision + 3,
    };
    const stale = await tool('music.useLibraryTrack').run(input, ctx);
    expect(stale.ok ? 'ok' : stale.error.code).toBe('core.conflict');
    expect(dispatched).toEqual([]);
    const key = tool('music.useLibraryTrack').idempotencyKey;
    expect(key?.(input)).toBe(key?.({ ...input }));
    expect(key?.(input)).not.toBe(key?.({ ...input, revision: timeline.revision }));
    expect(key?.(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('passes the empty-library error through', async () => {
    const { tool, ctx } = setup(timeline);
    const found = await tool('music.findLibraryTrack').run({}, ctx);
    expect(found.ok ? 'ok' : found.error.code).toBe('audio.music_library_empty');
  });
});
