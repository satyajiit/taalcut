// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame files are indexed by their size: whole frames become slots, one per
 * requested grid frame, and a file that isn't whole frames of the size it
 * should have (a picture scaled to another size) is an error, not frames
 * read at the wrong offsets.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { indexFrameFile } from '@taalcut/media';

describe('indexFrameFile', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-frame-files-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const spec = (path: string) => ({ set: 's', path, format: 'yuv420p' as const, width: 4, height: 2 });

  it('gives one slot per whole frame, in the requested frames’ order', async () => {
    const path = join(dir, 'whole.raw');
    await writeFile(path, Buffer.alloc(12 * 3));
    const file = await indexFrameFile({ ...spec(path), frames: [5, 9, 30] });
    expect(file.ok && file.value.slots).toEqual([
      { index: 5, offset: 0, length: 12 },
      { index: 9, offset: 12, length: 12 },
      { index: 30, offset: 24, length: 12 },
    ]);
  });

  it('rejects a file written at another size', async () => {
    const path = join(dir, 'other.raw');
    // 398×224 written where 400×224 was expected comes out as a remainder here: 12-byte frames, 34 bytes.
    await writeFile(path, Buffer.alloc(34));
    const file = await indexFrameFile({ ...spec(path), frames: [0, 1] });
    expect(file.ok).toBe(false);
    expect(!file.ok && file.error.detail).toContain('not whole 4x2 yuv420p frames');
  });
});
