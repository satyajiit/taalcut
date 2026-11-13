// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Byte helpers for the fake phone's sync v1 replies (little-endian u32 framing). */

export const DIR_MODE = 0o040755;
export const FILE_MODE = 0o100644;
const RECV_CHUNK = 2;

export const ID = {
  list: syncId('LIST'),
  recv: syncId('RECV'),
  stat: syncId('STAT'),
  dent: syncId('DENT'),
  done: syncId('DONE'),
  data: syncId('DATA'),
  fail: syncId('FAIL'),
} as const;

export function fileData(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += RECV_CHUNK) {
    const slice = bytes.subarray(offset, offset + RECV_CHUNK);
    parts.push(packet(ID.data, concat(u32(slice.byteLength), slice)));
  }
  return concatAll(parts);
}

export function stat(mode: number, size: number, mtime: number): Uint8Array {
  return packet(ID.stat, concatAll([u32(mode), u32(size), u32(mtime)]));
}

export function done(zeros: number): Uint8Array {
  return packet(ID.done, new Uint8Array(zeros));
}

export function fail(message: string): Uint8Array {
  const text = encode(message);
  return packet(ID.fail, concat(u32(text.byteLength), text));
}

export function syncId(text: string): number {
  return readU32(encode(text), 0);
}

export function packet(id: number, payload: Uint8Array): Uint8Array {
  return concat(u32(id), payload);
}

export function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

export function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

export function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

export function concatAll(parts: readonly Uint8Array[]): Uint8Array {
  return parts.reduce((sum, part) => concat(sum, part), new Uint8Array(0));
}
