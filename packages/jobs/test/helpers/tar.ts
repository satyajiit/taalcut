// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tiny ustar writer for tests, so archives (including hostile ones) are built
 * in memory instead of checked in.
 */
import { gzipSync, zstdCompressSync } from 'node:zlib';

export interface TarEntrySpec {
  readonly name: string;
  readonly type?: 'file' | 'directory' | 'symlink' | 'hardlink' | 'fifo';
  readonly data?: Buffer | string;
  readonly mode?: number;
  readonly linkName?: string;
  /** Write the name in a PAX 'path' record (for names over 100 bytes). */
  readonly pax?: boolean;
  /** Write the name as a GNU 'L' long-name entry. */
  readonly gnuLongName?: boolean;
}

const FLAGS = { file: '0', hardlink: '1', symlink: '2', directory: '5', fifo: '6' } as const;

export function makeTar(entries: readonly TarEntrySpec[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    const type = entry.type ?? 'file';
    let name = entry.name;
    if (entry.pax) {
      const record = paxRecord('path', entry.name);
      blocks.push(header({ name: 'PaxHeader', size: record.length, flag: 'x' }), pad(record));
      name = entry.name.slice(0, 100);
    } else if (entry.gnuLongName) {
      const long = Buffer.from(`${entry.name}\0`);
      blocks.push(
        header({ name: '././@LongLink', size: long.length, flag: 'L', magic: 'ustar  \0' }),
        pad(long),
      );
      name = entry.name.slice(0, 100);
    }
    const size = type === 'file' ? data.length : 0;
    const mode = entry.mode ?? (type === 'directory' ? 0o755 : 0o644);
    blocks.push(header({ name, size, flag: FLAGS[type], mode, linkName: entry.linkName }));
    if (size > 0) blocks.push(pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export const gzip = (tar: Buffer): Buffer => gzipSync(tar);
export const zstd = (tar: Buffer): Buffer => zstdCompressSync(tar);

function header(options: {
  name: string;
  size: number;
  flag: string;
  mode?: number;
  linkName?: string;
  magic?: string;
}): Buffer {
  const block = Buffer.alloc(512);
  block.write(options.name, 0, 100, 'utf8');
  octal(block, 100, 8, options.mode ?? 0o644);
  octal(block, 108, 8, 0);
  octal(block, 116, 8, 0);
  octal(block, 124, 12, options.size);
  octal(block, 136, 12, 1_700_000_000);
  block.write(options.flag, 156, 1, 'latin1');
  if (options.linkName) block.write(options.linkName, 157, 100, 'utf8');
  block.write(options.magic ?? 'ustar\u000000', 257, 8, 'latin1');
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1');
  return block;
}

function octal(block: Buffer, offset: number, length: number, value: number): void {
  block.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'latin1');
}

function pad(data: Buffer): Buffer {
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return padded;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length)
    length = String(length).length + Buffer.byteLength(body);
  return Buffer.from(`${length}${body}`);
}
