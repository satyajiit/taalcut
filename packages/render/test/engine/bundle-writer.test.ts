// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeBundle } from '../../src/engine/bundle-writer';

vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof FsPromises>();
  return { ...real, link: vi.fn(real.link) };
});

let root: string;
let source: string;
const content = Buffer.from('window.HyperFrames = {};\n');
const ioError = (code: string) => Object.assign(new Error(code), { code });
const bundle = (file: string) => ({
  files: { 'index.html': '<script src="_hf/runtime.js"></script>' },
  links: { '_hf/runtime.js': { source: file, key: 'runtime' } },
});

beforeEach(async () => {
  const real = await vi.importActual<typeof FsPromises>('node:fs/promises');
  vi.mocked(link).mockReset().mockImplementation(real.link);
  root = await mkdtemp(join(tmpdir(), 'taalcut-bundle-writer-'));
  source = join(root, 'runtime.js');
  await writeFile(source, content);
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe('composition bundle resources', () => {
  it('keeps hard links for ordinary files', async () => {
    const target = join(root, 'bundle');
    expect(await writeBundle(bundle(source), target)).toEqual({ copies: 0 });
    expect((await stat(join(target, '_hf/runtime.js'))).ino).toBe((await stat(source)).ino);
  });

  it.each(['ENOTDIR', 'ENOENT', 'EXDEV', 'EPERM', 'EMLINK'])(
    'copies readable resources when native linking reports %s',
    async (code) => {
      vi.mocked(link).mockRejectedValueOnce(ioError(code));
      const target = join(root, 'bundle');
      expect(await writeBundle(bundle(source), target)).toEqual({ copies: 1 });
      expect(await readFile(join(target, '_hf/runtime.js'))).toEqual(content);
      expect((await stat(join(target, '_hf/runtime.js'))).ino).not.toBe((await stat(source)).ino);
    },
  );

  it('still rejects a genuinely missing source', async () => {
    const target = join(root, 'bundle');
    await expect(writeBundle(bundle(join(root, 'missing.js')), target)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(target, '_hf/runtime.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not turn an unrelated I/O failure into a successful copy', async () => {
    vi.mocked(link).mockRejectedValueOnce(ioError('EIO'));
    await expect(writeBundle(bundle(source), join(root, 'bundle'))).rejects.toMatchObject({ code: 'EIO' });
  });

  it('refuses a resource destination outside the bundle before linking', async () => {
    await expect(
      writeBundle({ files: {}, links: { '../escaped.js': { source, key: 'escape' } } }, join(root, 'bundle')),
    ).rejects.toThrow('Bundle path escapes its folder');
    expect(link).not.toHaveBeenCalled();
    await expect(stat(join(root, 'escaped.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
