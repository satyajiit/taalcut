// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** library.listSources and library.listFiles: the sources so far, and "the first video" in a folder. */
import { mkdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, parseCard, unwrap, type AnyTool, type SourceView, type ToolContextBase } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, libraryToolModule, listMediaFiles, mediaTypeOf } from '../../src/index';
import { openTestDb, tempDir } from '../helpers';

function setup() {
  const trip = join(realpathSync(tempDir()), 'Trip');
  mkdirSync(join(trip, 'Sub'), { recursive: true });
  const files: [string, number][] = [
    ['clip 10.mov', 10],
    ['clip 2.MP4', 2],
    ['photo.heic', 3],
    ['voice.m4a', 4],
    ['notes.txt', 5],
    ['.hidden.mov', 6],
  ];
  for (const [name, size] of files) writeFileSync(join(trip, name), 'x'.repeat(size));
  writeFileSync(join(trip, 'Sub', 'deep.mov'), 'x');
  symlinkSync('/etc/hosts', join(trip, 'link.mov'));
  utimesSync(join(trip, 'clip 2.MP4'), 1_700_000_000, 1_700_000_000);
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const source = unwrap(repos.sources.add({ kind: 'watched_folder', displayName: 'Trip', rootPath: trip }));
  const module = libraryToolModule({
    db,
    search: { search: async () => unreachable(), findSimilar: async () => unreachable() },
    importStatus: async () => unreachable(),
  });
  const tool = (name: string) => module.tools.find((t) => t.name === name)! as AnyTool;
  return { trip, repos, source, tool };
}

const ctx: ToolContextBase = {
  signal: new AbortController().signal,
  callId: newId<'ToolRun'>(),
  attempt: 1,
  artifacts: { put: async () => unreachable(), get: async () => unreachable() },
  reportUsage: () => {},
  reportProgress: () => {},
};
function unreachable(): never {
  throw new Error('not used');
}

describe('library.listFiles', () => {
  it('lists first-level media files by name, numbers in order, with type, size and time', async () => {
    const s = setup();
    const input = s.tool('library.listFiles').input.parse({ sourceId: s.source.id });
    const listed = unwrap(await s.tool('library.listFiles').run(input, ctx)) as {
      files: { name: string; type: string; sizeBytes: number; modifiedAt: number; path: string }[];
      total: number;
    };
    expect(listed.files.map((f) => [f.name, f.type, f.sizeBytes])).toEqual([
      ['clip 2.MP4', 'video', 2],
      ['clip 10.mov', 'video', 10],
      ['photo.heic', 'image', 3],
      ['voice.m4a', 'audio', 4],
    ]);
    expect(listed.files[0]).toMatchObject({
      path: join(s.trip, 'clip 2.MP4'),
      modifiedAt: 1_700_000_000_000,
    });
    expect(listed.total).toBe(4);
  });

  it('stops at the limit but counts everything, and says so when the folder is gone', async () => {
    const s = setup();
    expect(unwrap(await listMediaFiles(s.trip, 1))).toMatchObject({
      files: [{ name: 'clip 2.MP4' }],
      total: 4,
    });
    rmSync(s.trip, { recursive: true, force: true });
    const gone = await s.tool('library.listFiles').run({ sourceId: s.source.id, limit: 5 }, ctx);
    expect(!gone.ok && gone.error.code).toBe('library.folder_missing');
    // Named by the source's label, for "The Trip folder isn't on this Mac any more".
    expect(!gone.ok && gone.error.params).toMatchObject({ name: s.source.displayName });
    const unknown = await s.tool('library.listFiles').run({ sourceId: newId(), limit: 5 }, ctx);
    expect(!unknown.ok && unknown.error.code).toBe('core.not_found');
  });

  it('knows media types by extension, in any case', () => {
    expect([mediaTypeOf('a.MOV'), mediaTypeOf('b.dng'), mediaTypeOf('c.flac'), mediaTypeOf('d.pdf')]).toEqual(
      ['video', 'image', 'audio', undefined],
    );
  });
});

describe('library.listSources 1.1.0', () => {
  it('lists the sources with file counts and scan state, shown as the source picker', async () => {
    const s = setup();
    const tool = s.tool('library.listSources');
    expect(tool.version).toBe('1.1.0');
    const listed = unwrap(await tool.run({}, ctx)) as { sources: SourceView[] };
    expect(listed.sources).toEqual([
      {
        id: s.source.id,
        kind: 'watched_folder',
        name: 'Trip',
        status: 'online',
        path: s.trip,
        watch: true,
        scan: { state: 'idle', lastScanAt: null },
        assets: 0,
        missing: 0,
        createdAt: s.source.createdAt,
      },
    ]);
    expect(tool.output.safeParse(listed).success).toBe(true);
    const runId = newId<'AgentRun'>();
    const card = unwrap(
      await tool.resultCard!(listed, { runId, toolCallId: ctx.callId, projectId: null, signal: ctx.signal }),
    );
    expect(parseCard(card).ok).toBe(true);
    expect(card).toMatchObject({
      type: 'sourcePicker',
      runId,
      offers: ['folder', 'phone'],
      status: 'pending',
    });
  });
});
