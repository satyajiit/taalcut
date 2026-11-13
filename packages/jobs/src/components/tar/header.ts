// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tar header parsing: ustar, with PAX ('x') and GNU long-name ('L'/'K')
 * extensions, which is what bsdtar and GNU tar write.
 */
import { TarError } from './byte-reader';

export const BLOCK_SIZE = 512;

export type TarEntryType =
  | 'file'
  | 'directory'
  | 'symlink'
  | 'hardlink'
  | 'pax'
  | 'pax-global'
  | 'gnu-longname'
  | 'gnu-longlink'
  | 'unsupported';

export interface TarHeader {
  readonly name: string;
  readonly mode: number;
  readonly size: number;
  readonly type: TarEntryType;
  readonly typeFlag: string;
  readonly linkName: string;
}

const TYPES: Record<string, TarEntryType> = {
  '0': 'file',
  '\0': 'file',
  '7': 'file',
  '1': 'hardlink',
  '2': 'symlink',
  '5': 'directory',
  x: 'pax',
  g: 'pax-global',
  L: 'gnu-longname',
  K: 'gnu-longlink',
};

export function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) if (byte !== 0) return false;
  return true;
}

export function paddedSize(size: number): number {
  return Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
}

export function parseHeader(block: Buffer): TarHeader {
  if (block.length !== BLOCK_SIZE) throw new TarError('short tar header');
  const stored = readNumber(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
  if (sum !== stored) throw new TarError('tar header checksum mismatch (not a tar archive, or corrupt)');
  const typeFlag = String.fromCharCode(block[156]!);
  const posix = block.toString('latin1', 257, 263) === 'ustar\0';
  const prefix = posix ? readString(block, 345, 155) : '';
  const name = readString(block, 0, 100);
  return {
    name: prefix ? `${prefix}/${name}` : name,
    mode: readNumber(block, 100, 8),
    size: readNumber(block, 124, 12),
    type: TYPES[typeFlag] ?? 'unsupported',
    typeFlag,
    linkName: readString(block, 157, 100),
  };
}

/** A NUL-terminated string field. */
export function readString(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.toString('utf8', 0, end === -1 ? field.length : end);
}

/** An octal field, or GNU base-256 for values that do not fit (files over 8 GiB). */
function readNumber(block: Buffer, start: number, length: number): number {
  const first = block[start]!;
  if (first & 0x80) {
    if (first === 0xff) throw new TarError('negative number in tar header');
    let value = first & 0x7f;
    for (let i = start + 1; i < start + length; i++) value = value * 256 + block[i]!;
    if (!Number.isSafeInteger(value)) throw new TarError('number in tar header is too large');
    return value;
  }
  const text = block
    .toString('latin1', start, start + length)
    .replace(/[\0 ]+$/g, '')
    .replace(/^ +/, '');
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarError(`bad octal field '${text}' in tar header`);
  return parseInt(text, 8);
}

/** PAX extended header records: '<length> <key>=<value>\n'. */
export function parsePax(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    if (data[pos] === 0) break;
    const space = data.indexOf(0x20, pos);
    const length = space === -1 ? NaN : Number(data.toString('latin1', pos, space));
    if (!Number.isInteger(length) || length <= 0 || pos + length > data.length) {
      throw new TarError('malformed PAX header');
    }
    const record = data.toString('utf8', space + 1, pos + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1);
    pos += length;
  }
  return records;
}
