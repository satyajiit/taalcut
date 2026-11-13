// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Durable writes leave only the real name behind (a fixed temp a crash left is reused, a failed rename takes its
 * temp with it), and a move is a rename or, across volumes, a copy that never lands on an existing file.
 */
import type * as FsPromises from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fsyncPath, moveFile, uniqueTemp, writeDurably } from '../../src/files/durable-files';
import { tempDir } from '../helpers';

const volumes = vi.hoisted(() => ({ crossed: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const rename: typeof actual.rename = async (from, to) => {
    if (volumes.crossed) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    return actual.rename(from, to);
  };
  return { ...actual, rename };
});

function acrossVolumes<T>(work: () => Promise<T>): Promise<T> {
  volumes.crossed = true;
  return work().finally(() => {
    volumes.crossed = false;
  });
}

describe('durable files', () => {
  it('writes bytes or text under the real name and leaves no temp file', async () => {
    const dir = tempDir();
    await writeDurably(join(dir, 'sheet'), new Uint8Array([1, 2, 3]));
    await writeDurably(join(dir, 'journal'), 'hello');
    expect([...readFileSync(join(dir, 'sheet'))]).toEqual([1, 2, 3]);
    expect(readFileSync(join(dir, 'journal'), 'utf8')).toBe('hello');
    expect(readdirSync(dir).sort()).toEqual(['journal', 'sheet']);
  });

  it('reuses a fixed temp name a crash left behind', async () => {
    const dir = tempDir();
    const path = join(dir, 'upload.dest');
    writeFileSync(`${path}.tmp`, 'half a journal from before the crash');
    await writeDurably(path, '/Originals/clip.mov', `${path}.tmp`);
    expect(readFileSync(path, 'utf8')).toBe('/Originals/clip.mov');
    expect(readdirSync(dir)).toEqual(['upload.dest']);
  });

  it('takes its temp file with it when the rename fails', async () => {
    const dir = tempDir();
    const path = join(dir, 'taken');
    mkdirSync(join(path, 'inside'), { recursive: true });
    await expect(writeDurably(path, 'bytes')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['taken']);
  });

  it('gives each write its own temp name beside the target', () => {
    const path = join(tempDir(), 'a');
    expect(uniqueTemp(path)).not.toBe(uniqueTemp(path));
    expect(uniqueTemp(path)).toMatch(/\/a\.[0-9a-f]{12}\.tmp$/);
  });

  it('moves by rename on one volume', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'from'), 'take');
    await moveFile(join(dir, 'from'), join(dir, 'to'));
    expect(readdirSync(dir)).toEqual(['to']);
    expect(readFileSync(join(dir, 'to'), 'utf8')).toBe('take');
  });

  it('copies, then removes the source, across volumes', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'from'), 'take');
    await acrossVolumes(() => moveFile(join(dir, 'from'), join(dir, 'to')));
    expect(readdirSync(dir)).toEqual(['to']);
    expect(readFileSync(join(dir, 'to'), 'utf8')).toBe('take');
  });

  it('never copies over an existing file across volumes', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'from'), 'new');
    writeFileSync(join(dir, 'to'), 'kept');
    await expect(acrossVolumes(() => moveFile(join(dir, 'from'), join(dir, 'to')))).rejects.toThrow();
    expect(readFileSync(join(dir, 'to'), 'utf8')).toBe('kept');
    expect(existsSync(join(dir, 'from'))).toBe(true);
  });

  it('fsyncs a file or a folder, and throws for a missing one', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'file'), 'x');
    await fsyncPath(join(dir, 'file'));
    await fsyncPath(dir);
    await expect(fsyncPath(join(dir, 'gone'))).rejects.toThrow();
  });
});
