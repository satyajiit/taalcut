// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-EXPORTNAMES: a finished render is delivered to the person's exports folder under its own name (the owner,
// 2026-11-15: "the exported dir name is weird also the file names": it was renders/<project id>/<render id>.mp4
// inside the app's data folder).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newId, type ProjectId, type RenderId } from '@taalcut/core';
import { exportFileStem, renderDelivery, renderDestination } from '../../src/store/paths';

const projectId: ProjectId = newId<'Project'>();
const id: RenderId = newId<'Render'>();
const record = { id, projectId, name: 'Journey in Quick Glimpses – 4K master (9:16)' };
const folders = { renders: '/data/renders', exports: '/Movies/Taalcut/Exports' };
const holding =
  (...taken: string[]) =>
  async (path: string) =>
    taken.includes(path);

describe('a render’s file name', () => {
  it('is its display name, made safe for a file system', () => {
    expect(exportFileStem(record.name)).toBe('Journey in Quick Glimpses – 4K master (9x16)');
    expect(exportFileStem('  ..Goa / Day 1: sunrise\\beach\u0000  ')).toBe('Goa Day 1 sunrise beach');
    expect(exportFileStem('Reel 16 : 9 at 10:30')).toBe('Reel 16x9 at 10x30');
    expect(exportFileStem(' ./:\\ ')).toBe('Taalcut export');
  });

  it('fits a file name in any script, and never cuts a character in half', () => {
    const hindi = exportFileStem('यात्रा की झलकियाँ '.repeat(20));
    expect(Buffer.byteLength(hindi, 'utf8')).toBeLessThanOrEqual(200);
    expect(Buffer.from(hindi, 'utf8').toString('utf8')).toBe(hindi);
    expect(hindi.endsWith(' ')).toBe(false);
    const emoji = exportFileStem('🎬'.repeat(80));
    expect(Buffer.byteLength(emoji, 'utf8')).toBe(200);
    expect([...emoji]).toHaveLength(50);
  });
});

describe('where a finished render goes', () => {
  it('is the exports folder under its own name, sidecars beside it', async () => {
    const delivery = await renderDelivery(folders, record, holding());
    const stem = join(folders.exports, 'Journey in Quick Glimpses – 4K master (9x16)');
    expect(delivery.file).toBe(`${stem}.mp4`);
    expect(delivery.sidecar('srt')).toBe(`${stem}.srt`);
    expect(delivery.sidecar('vtt')).toBe(`${stem}.vtt`);
  });

  it('takes the next free name, as Finder does, when the video or a sidecar of that name is there', async () => {
    const stem = join(folders.exports, 'Journey in Quick Glimpses – 4K master (9x16)');
    const second = await renderDelivery(folders, record, holding(`${stem}.mp4`));
    expect(second.file).toBe(`${stem} 2.mp4`);
    expect(second.sidecar('srt')).toBe(`${stem} 2.srt`);
    // A sidecar alone holds the name too: the video and its captions always share a stem.
    const third = await renderDelivery(folders, record, holding(`${stem}.mp4`, `${stem} 2.vtt`));
    expect(third.file).toBe(`${stem} 3.mp4`);
    // A thousand of one name: the render's id is never taken.
    const full = await renderDelivery(folders, record, async () => true);
    expect(full.file).toBe(`${stem} ${id}.mp4`);
  });

  it('is the renders folder by id where there is no exports folder', async () => {
    const delivery = await renderDelivery({ renders: folders.renders }, record, async () => true);
    expect(delivery.file).toBe(renderDestination(folders, projectId, id));
    expect(delivery.file).toBe(join('/data/renders', projectId, `${id}.mp4`));
    expect(delivery.sidecar('srt')).toBe(join('/data/renders', projectId, `${id}.srt`));
  });
});
