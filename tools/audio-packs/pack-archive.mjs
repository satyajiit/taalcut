// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A component archive with nothing that varies between builds: a plain ustar written here (files only, at the
 * archive root, names sorted, mode 0644, uid and gid 0, empty owner names, mtime 0), compressed with zstd level 19
 * through Node's own zlib. No platform tar, so no macOS metadata and no flags that differ between tar builds.
 * Returns what the manifest records: sha256 and size of the archive, extractedSize (the files' bytes).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';

const BLOCK = 512;

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name, size) {
  if (Buffer.byteLength(name) > 100) throw new Error(`${name}: ustar names are at most 100 bytes`);
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 'utf8');
  block.write(octal(0o644, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(0, 12), 136, 'ascii');
  block.fill(' ', 148, 156);
  block.write('0', 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

/** The ustar bytes of `names` (files in `dir`), sorted by name. */
export function ustar(dir, names) {
  const parts = [];
  let extractedSize = 0;
  for (const name of [...names].sort()) {
    const data = readFileSync(join(dir, name));
    extractedSize += data.length;
    parts.push(header(name, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return { tar: Buffer.concat(parts), extractedSize };
}

export function writeArchive(dir, names, archivePath) {
  const { tar, extractedSize } = ustar(dir, names);
  const archive = zstdCompressSync(tar, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });
  writeFileSync(archivePath, archive);
  return {
    sha256: createHash('sha256').update(archive).digest('hex'),
    size: archive.length,
    extractedSize,
  };
}
