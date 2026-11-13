// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { extract, packTarZst } from './archive.mjs';
import { listEntries, sha256File } from './files.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function tree() {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-archive-test-'));
  dirs.push(root);
  const src = join(root, 'src');
  await mkdir(join(src, 'bin'), { recursive: true });
  await writeFile(join(src, 'b.txt'), 'bee\n');
  await writeFile(join(src, 'a.json'), '{"a":1}\n');
  await writeFile(join(src, 'bin', 'tool'), '#!/bin/sh\necho hi\n');
  await chmod(join(src, 'bin', 'tool'), 0o700);
  await symlink('tool', join(src, 'bin', 'tool-link'));
  return { root, src };
}

describe('packTarZst', () => {
  for (const layout of ['stream', 'file']) {
    it(`gives the same bytes twice (${layout}) and measures the regular files`, async () => {
      const { root, src } = await tree();
      const first = join(root, 'one.tar.zst');
      const second = join(root, 'two.tar.zst');
      assert.equal(await packTarZst({ root: src, out: first, layout }), 4 + 8 + 18);
      await writeFile(join(src, 'b.txt'), 'bee\n'); // a fresh mtime: the recipe resets it
      assert.equal(await packTarZst({ root: src, out: second, layout }), 30);
      assert.equal(await sha256File(first), await sha256File(second));
    });
  }

  it('lists files in byte order without folders, and the layouts differ only in framing', async () => {
    const { root, src } = await tree();
    assert.deepEqual(await listEntries(src), ['a.json', 'b.txt', 'bin/tool', 'bin/tool-link']);
    const stream = join(root, 's.tar.zst');
    const file = join(root, 'f.tar.zst');
    await packTarZst({ root: src, out: stream, layout: 'stream' });
    await packTarZst({ root: src, out: file, layout: 'file' });
    const tarOf = (path) => execFileSync('zstd', ['-dc', path]);
    const [s, f] = [tarOf(stream), tarOf(file)];
    assert.equal(s.length % 10240, 0, 'bsdtar pads a piped tar to its 10240-byte record');
    assert.equal(f.length % 10240 === 0, false, 'a 512-byte-block tar ends after its two zero blocks');
    assert.deepEqual(s.subarray(0, f.length - 1024), f.subarray(0, f.length - 1024));
  });

  it('round-trips through extract with the recipe modes and the symlink', async () => {
    const { root, src } = await tree();
    const out = join(root, 'x.tar.zst');
    await packTarZst({ root: src, out, layout: 'stream' });
    const into = join(root, 'into');
    await extract(out, 'tar.zst', into);
    assert.equal(await readFile(join(into, 'b.txt'), 'utf8'), 'bee\n');
    assert.equal((await lstat(join(into, 'bin', 'tool'))).mode & 0o777, 0o755);
    assert.equal((await lstat(join(into, 'a.json'))).mode & 0o777, 0o644);
    assert.equal(await readlink(join(into, 'bin', 'tool-link')), 'tool');
    assert.equal((await lstat(join(into, 'a.json'))).mtimeMs, 0);
  });

  it('an explicit model compression level stays deterministic and preserves every source byte', async () => {
    const { root, src } = await tree();
    for (const layout of ['stream', 'file']) {
      const first = join(root, `${layout}-one.tar.zst`);
      const second = join(root, `${layout}-two.tar.zst`);
      const original = join(root, `${layout}-default.tar.zst`);
      await packTarZst({ root: src, out: first, layout, compressionLevel: 3 });
      await packTarZst({ root: src, out: second, layout, compressionLevel: 3 });
      await packTarZst({ root: src, out: original, layout });
      assert.equal(await sha256File(first), await sha256File(second));
      assert.deepEqual(execFileSync('zstd', ['-dc', first]), execFileSync('zstd', ['-dc', original]));
    }
    for (const compressionLevel of [0, 20, 1.5, '3'])
      await assert.rejects(
        packTarZst({ root: src, out: join(root, 'invalid'), layout: 'stream', compressionLevel }),
        /compressionLevel/,
      );
  });

  it('refuses an unknown layout and an empty folder', async () => {
    const { root, src } = await tree();
    await assert.rejects(
      packTarZst({ root: src, out: join(root, 'z'), layout: 'zip' }),
      /unknown archive layout/,
    );
    const empty = join(root, 'empty');
    await mkdir(empty);
    await assert.rejects(
      packTarZst({ root: empty, out: join(root, 'e'), layout: 'file' }),
      /nothing to pack/,
    );
  });
});
