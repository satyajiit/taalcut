// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX1-IMPORT: what a folder import skips quietly instead of counting as a file that couldn't be read. Camera
 * sidecars (an iPhone's .AAE edits, a GoPro's .THM poster and .LRV low-res copy, Lightroom's .XMP, subtitles)
 * are not media Taalcut imports; an empty file has no media yet, and is added once it has bytes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { library, writeMedia } from './fixture';

describe('a folder import skips what is not media yet', () => {
  it('leaves sidecars out without counting them', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'IMG_0001.MOV');
    for (const sidecar of ['IMG_0001.AAE', 'GX010001.THM', 'GL010001.LRV', 'IMG_0001.xmp', 'clip.srt'])
      writeMedia(root, sidecar, 512);

    const counts = await lib.scan({ sourceId: id, mode: 'full' });
    expect(counts).toMatchObject({ end: 'done', seen: 1, added: 1, failed: 0 });
    expect(lib.locations(id).map((l) => l.path)).toEqual(['IMG_0001.MOV']);
  });

  it('skips an empty file quietly and adds it once it has bytes', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'a.mp4');
    writeMedia(root, 'copying.mp4', 0);

    const first = await lib.scan({ sourceId: id, mode: 'full' });
    expect(first).toMatchObject({ end: 'done', seen: 1, added: 1, failed: 0 });
    expect(lib.assetCount()).toBe(1);

    writeFileSync(join(root, 'copying.mp4'), new Uint8Array(4096).fill(7));
    const second = await lib.scan({ sourceId: id, mode: 'full' });
    expect(second).toMatchObject({ added: 1, failed: 0 });
    expect(lib.locations(id).map((l) => l.path)).toEqual(['a.mp4', 'copying.mp4']);
  });
});
