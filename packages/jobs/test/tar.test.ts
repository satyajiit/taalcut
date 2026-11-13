// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Archive extraction: the formats and tar dialects we accept, and the hostile
 * archives we refuse (traversal, link escapes, bombs, unsupported entries).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ByteReader, TarError } from '../src/components/tar/byte-reader';
import { extractTar, isInside, safeSegments, type ExtractOptions } from '../src/components/tar/extract';
import { parseHeader, parsePax } from '../src/components/tar/header';
import { listFiles, tempDir } from './helpers/fixtures';
import { gzip, makeTar, zstd, type TarEntrySpec } from './helpers/tar';

let dir: string;
let out: string;

beforeEach(async () => {
  dir = await tempDir();
  out = join(dir, 'out');
  await mkdir(out);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function extract(archive: Buffer, options: Partial<ExtractOptions> = {}) {
  const path = join(dir, 'archive');
  await writeFile(path, archive);
  return extractTar(path, out, { format: 'tar', stripComponents: 0, maxBytes: 1_000_000, ...options });
}

const sample: TarEntrySpec[] = [
  { name: 'pkg/', type: 'directory' },
  { name: 'pkg/lib/libonnxruntime.1.0.dylib', data: 'dylib', mode: 0o755 },
  { name: 'pkg/lib/libonnxruntime.dylib', type: 'symlink', linkName: 'libonnxruntime.1.0.dylib' },
  { name: 'pkg/README', data: 'read me' },
];

describe('extractTar', () => {
  it('extracts files, folders, executable bits and relative symlinks', async () => {
    const summary = await extract(makeTar(sample));
    expect(summary).toEqual({ files: 2, directories: 1, symlinks: 1, bytes: 12 });
    expect(await listFiles(out)).toEqual([
      'pkg/README',
      'pkg/lib/libonnxruntime.1.0.dylib',
      'pkg/lib/libonnxruntime.dylib',
    ]);
    expect((await lstat(join(out, 'pkg/lib/libonnxruntime.1.0.dylib'))).mode & 0o777).toBe(0o755);
    expect((await lstat(join(out, 'pkg/README'))).mode & 0o777).toBe(0o644);
    expect(await readlink(join(out, 'pkg/lib/libonnxruntime.dylib'))).toBe('libonnxruntime.1.0.dylib');
    expect(await readFile(join(out, 'pkg/lib/libonnxruntime.dylib'), 'utf8')).toBe('dylib');
  });

  it('strips leading path segments', async () => {
    await extract(makeTar(sample), { stripComponents: 1 });
    expect(await listFiles(out)).toEqual([
      'README',
      'lib/libonnxruntime.1.0.dylib',
      'lib/libonnxruntime.dylib',
    ]);
  });

  it('reads gzip and zstd, PAX long names and GNU long names', async () => {
    const long = `deep/${'a'.repeat(120)}/model.onnx`;
    const gnu = `other/${'b'.repeat(120)}.bin`;
    const tar = makeTar([
      { name: long, data: 'weights', pax: true },
      { name: gnu, data: 'gnu', gnuLongName: true },
    ]);
    await extract(gzip(tar), { format: 'tar.gz' });
    expect(await readFile(join(out, long), 'utf8')).toBe('weights');
    expect(await readFile(join(out, gnu), 'utf8')).toBe('gnu');
    await rm(out, { recursive: true });
    await mkdir(out);
    await extract(zstd(tar), { format: 'tar.zst' });
    expect(await listFiles(out)).toEqual([gnu, long].sort());
  });

  it.skipIf(!existsSync('/usr/bin/tar'))(
    'extracts an archive made by the system tar (bsdtar, PAX headers)',
    async () => {
      const src = join(dir, 'src');
      await mkdir(join(src, 'bin'), { recursive: true });
      await writeFile(join(src, 'bin', 'tool'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
      await writeFile(join(src, `${'n'.repeat(150)}.txt`), 'long name');
      const archive = join(dir, 'real.tar.gz');
      execFileSync('/usr/bin/tar', ['-czf', archive, '-C', src, '.'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      });
      await extractTar(archive, out, { format: 'tar.gz', stripComponents: 0, maxBytes: 1000 });
      expect(await listFiles(out)).toEqual(['bin/tool', `${'n'.repeat(150)}.txt`]);
      expect((await lstat(join(out, 'bin', 'tool'))).mode & 0o111).not.toBe(0);
    },
  );

  it.each([
    ['a parent-directory path', [{ name: '../evil', data: 'x' }], /unsafe path/],
    ['an absolute path', [{ name: '/etc/evil', data: 'x' }], /unsafe path/],
    ['a backslash path', [{ name: '..\\evil', data: 'x' }], /unsafe path/],
    ['a symlink out of the folder', [{ name: 'l', type: 'symlink', linkName: '../../x' }], /points outside/],
    ['an absolute symlink', [{ name: 'l', type: 'symlink', linkName: '/etc/passwd' }], /unsafe symlink/],
    ['a hard link', [{ name: 'h', type: 'hardlink', linkName: 'a' }], /unsupported tar entry type '1'/],
    ['a FIFO', [{ name: 'f', type: 'fifo' }], /unsupported tar entry type '6'/],
    [
      'a link chain that escapes through an earlier link',
      [
        { name: 'p/q', type: 'symlink', linkName: '..' },
        { name: 'p/q/z', type: 'symlink', linkName: '../../x' },
      ],
      /nothing is extracted through a link/,
    ],
    [
      'a link that climbs out through an earlier link while its name stays inside',
      [
        { name: 'a/b/c/d/up', type: 'symlink', linkName: '../../../..' },
        { name: 'leak', type: 'symlink', linkName: 'a/b/c/d/up/../evil' },
      ],
      /points outside/,
    ],
    [
      'a link that only escapes once a later link exists',
      [
        { name: 'x', type: 'symlink', linkName: 'n/../evil' },
        { name: 'n', type: 'symlink', linkName: '.' },
      ],
      /points outside/,
    ],
    ['a link loop', [{ name: 'loop', type: 'symlink', linkName: 'loop/x' }], /loops/],
  ] as [string, TarEntrySpec[], RegExp][])('refuses %s', async (_, entries, message) => {
    await expect(extract(makeTar(entries))).rejects.toThrow(message);
    await expect(lstat(join(dir, 'evil'))).rejects.toThrow();
  });

  it('accepts links that lead through other links and stay inside', async () => {
    await extract(
      makeTar([
        { name: 'bin/tool', type: 'symlink', linkName: '../current/libfoo.dylib' },
        { name: 'current', type: 'symlink', linkName: 'lib' },
        { name: 'lib/libfoo.dylib', type: 'symlink', linkName: 'libfoo.1.dylib' },
        { name: 'lib/libfoo.1.dylib', type: 'symlink', linkName: './libfoo.1.0.dylib' },
        { name: 'lib/libfoo.1.0.dylib', data: 'dylib' },
        { name: 'lib/dangling', type: 'symlink', linkName: 'not-shipped/../still-inside' },
      ]),
    );
    expect(await readFile(join(out, 'bin/tool'), 'utf8')).toBe('dylib');
  });

  it('creates nothing outside the folder when a later entry goes through an escaping link', async () => {
    // Review 2: `leak` resolves outside; a mkdir -p for `leak/nested` used to follow it.
    const outside = join(dir, 'OUTSIDE');
    await mkdir(outside);
    await writeFile(join(outside, 'preexisting.txt'), 'keep');
    const archive = makeTar([
      { name: 'a/b/c/d/up', type: 'symlink', linkName: '../../../..' },
      { name: 'leak', type: 'symlink', linkName: 'a/b/c/d/up/../OUTSIDE' },
      { name: 'leak/nested/marker', type: 'symlink', linkName: 'm' },
    ]);
    await expect(extract(archive)).rejects.toThrow(TarError);
    expect(await readdir(outside)).toEqual(['preexisting.txt']);
  });

  it('never writes through a link that is already in the folder', async () => {
    const outside = join(dir, 'OUTSIDE');
    await mkdir(outside);
    await writeFile(join(outside, 'victim'), 'keep');
    await symlink('../OUTSIDE', join(out, 'leak'));
    await symlink('../OUTSIDE/victim', join(out, 'f'));
    await expect(extract(makeTar([{ name: 'leak/pwned.txt', data: 'PWNED' }]))).rejects.toThrow(
      /nothing is extracted through a link/,
    );
    await expect(extract(makeTar([{ name: 'f', data: 'PWNED' }]))).rejects.toThrow(
      /nothing is extracted through a link/,
    );
    expect(await readdir(outside)).toEqual(['victim']);
    expect(await readFile(join(outside, 'victim'), 'utf8')).toBe('keep');
  });

  it('stops a decompression bomb at the declared size', async () => {
    const tar = makeTar([{ name: 'big', data: Buffer.alloc(5000) }]);
    await expect(extract(gzip(tar), { format: 'tar.gz', maxBytes: 4096 })).rejects.toThrow(
      /more than the 4096 bytes/,
    );
  });

  it('rejects corrupt and truncated archives', async () => {
    const tar = makeTar(sample);
    const corrupt = Buffer.from(tar);
    corrupt[10] = corrupt[10]! ^ 0xff;
    await expect(extract(corrupt)).rejects.toThrow(/checksum mismatch/);
    await expect(extract(tar.subarray(0, 512 + 100))).rejects.toThrow(/unexpected end of archive/);
    await expect(extract(Buffer.from('not gzip at all'), { format: 'tar.gz' })).rejects.toMatchObject({
      code: expect.stringMatching(/^Z_/),
    });
  });

  it('can be cancelled', async () => {
    await expect(extract(makeTar(sample), { signal: AbortSignal.abort() })).rejects.toThrow(/abort/i);
  });
});

describe('tar parsing helpers', () => {
  it('parses PAX records and rejects malformed ones', () => {
    expect(parsePax(Buffer.from('16 path=a/b/c.x\n11 size=99\n'))).toEqual({ path: 'a/b/c.x', size: '99' });
    expect(() => parsePax(Buffer.from('99 path=x\n'))).toThrow(TarError);
  });

  it('reads base-256 sizes and rejects bad octal fields', () => {
    const block = makeTar([{ name: 'f', data: 'x' }]).subarray(0, 512);
    const big = Buffer.from(block);
    big.fill(0, 124, 136);
    big[124] = 0x80;
    big[135] = 0x10;
    fixChecksum(big);
    expect(parseHeader(big).size).toBe(16);
    const bad = Buffer.from(block);
    bad.write('99999999999\0', 124, 'latin1');
    fixChecksum(bad);
    expect(() => parseHeader(bad)).toThrow(/bad octal/);
  });

  it('validates paths', () => {
    expect(safeSegments('./a//b/', 0)).toEqual(['a', 'b']);
    expect(safeSegments('top/', 1)).toBeUndefined();
    expect(() => safeSegments('a/../../b', 0)).toThrow(TarError);
    expect(isInside('/root/x', '/root/x/y')).toBe(true);
    expect(isInside('/root/x', '/root/x')).toBe(true);
    expect(isInside('/root/x', '/root/x/..y')).toBe(true);
    expect(isInside('/root/x', '/root/xy')).toBe(false);
  });

  it('reads exact sizes across chunk boundaries', async () => {
    async function* source() {
      yield Buffer.from('abc');
      yield new Uint8Array([100, 101]);
      yield Buffer.alloc(0);
      yield Buffer.from('fghij');
    }
    const reader = new ByteReader(source());
    expect((await reader.read(4))!.toString()).toBe('abcd');
    const pieces: string[] = [];
    for await (const piece of reader.stream(3)) pieces.push(piece.toString());
    expect(pieces.join('')).toBe('efg');
    await expect(reader.read(10)).rejects.toThrow(/unexpected end/);
  });
});

function fixChecksum(block: Buffer): void {
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1');
}
