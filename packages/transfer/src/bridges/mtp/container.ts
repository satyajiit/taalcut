// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PTP containers: 4-byte length, 2-byte type, 2-byte code, 4-byte transaction, payload.
 * A PTP string is a count of UTF-16LE code units including the trailing null. Count 0 is empty.
 */
import { DATATYPE_UINT64, FORMAT_ASSOCIATION, SIZE_32_UNKNOWN, TYPE_COMMAND } from './codes';

export interface PtpContainer {
  readonly length: number;
  readonly type: number;
  readonly code: number;
  readonly transactionId: number;
  readonly payload: Uint8Array;
}

export interface ObjectInfo {
  readonly storageId: number;
  readonly format: number;
  readonly size: number;
  /** False when the 32-bit size is 0xFFFFFFFF (4 GiB or more) and nothing has told the real size yet. */
  readonly sizeKnown: boolean;
  readonly width: number;
  readonly height: number;
  readonly parent: number;
  readonly name: string;
  readonly createdAt: number | null;
  readonly modifiedAt: number | null;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.byteLength;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function encodeContainer(
  type: number,
  code: number,
  transactionId: number,
  payload: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(12 + payload.byteLength);
  const view = viewOf(out);
  view.setUint32(0, out.byteLength, true);
  view.setUint16(4, type, true);
  view.setUint16(6, code, true);
  view.setUint32(8, transactionId, true);
  out.set(payload, 12);
  return out;
}

export function encodeCommand(code: number, transactionId: number, params: readonly number[]): Uint8Array {
  return encodeContainer(TYPE_COMMAND, code, transactionId, encodeParams(params));
}

export function decodeContainer(bytes: Uint8Array): PtpContainer | null {
  if (bytes.byteLength < 12) return null;
  const view = viewOf(bytes);
  const length = view.getUint32(0, true);
  if (length < 12 || bytes.byteLength < length) return null;
  return {
    length,
    type: view.getUint16(4, true),
    code: view.getUint16(6, true),
    transactionId: view.getUint32(8, true),
    payload: bytes.subarray(12, length),
  };
}

export function encodeParams(params: readonly number[]): Uint8Array {
  const out = new Uint8Array(params.length * 4);
  const view = viewOf(out);
  for (let index = 0; index < params.length; index += 1) {
    const value = params[index] ?? 0;
    view.setUint32(index * 4, value, true);
  }
  return out;
}

export function parseParams(payload: Uint8Array): number[] {
  const view = viewOf(payload);
  const out: number[] = [];
  for (let offset = 0; offset + 4 <= payload.byteLength; offset += 4) out.push(view.getUint32(offset, true));
  return out;
}

export function encodeIdArray(ids: readonly number[]): Uint8Array {
  return encodeParams([ids.length, ...ids]);
}

export function parseIdArray(payload: Uint8Array): number[] | null {
  const values = parseParams(payload);
  const count = values[0];
  if (count === undefined || values.length < 1 + count) return null;
  return values.slice(1, 1 + count);
}

export function encodePtpString(text: string): Uint8Array {
  if (text.length === 0) return Uint8Array.of(0);
  const count = text.length + 1;
  const out = new Uint8Array(1 + count * 2);
  out[0] = count;
  const view = viewOf(out);
  for (let index = 0; index < text.length; index += 1)
    view.setUint16(1 + index * 2, text.charCodeAt(index), true);
  return out;
}

export function readPtpString(
  bytes: Uint8Array,
  offset: number,
): { readonly text: string; readonly next: number } {
  const count = bytes[offset] ?? 0;
  if (offset >= bytes.byteLength) return { text: '', next: offset };
  if (count === 0) return { text: '', next: offset + 1 };
  const start = offset + 1;
  const end = start + count * 2;
  if (end > bytes.byteLength) return { text: '', next: bytes.byteLength };
  const units = count - 1;
  const view = viewOf(bytes);
  let text = '';
  for (let index = 0; index < units; index += 1)
    text += String.fromCharCode(view.getUint16(start + index * 2, true));
  return { text, next: end };
}

/**
 * A PTP DateTime, "YYYYMMDDThhmmss[.s][Z|±hhmm]". Without a zone it is the phone's local time, which
 * is read as the Mac's local time (the phone and the Mac are side by side); Z and an offset are honoured.
 */
export function parsePtpDate(text: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?(Z|[+-]\d{4})?$/.exec(text.trim());
  if (!match) return null;
  const year = group(match, 1);
  const month = group(match, 2);
  const day = group(match, 3);
  const hour = group(match, 4);
  const minute = group(match, 5);
  const second = group(match, 6);
  if (year === null || month === null || day === null || hour === null || minute === null || second === null)
    return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  const zone = match[7];
  if (zone === undefined) return new Date(year, month - 1, day, hour, minute, second).getTime();
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (zone === 'Z') return utc;
  const sign = zone.startsWith('-') ? -1 : 1;
  const offset = (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5))) * 60_000;
  return utc - sign * offset;
}

export function encodeObjectInfo(
  info: Omit<ObjectInfo, 'sizeKnown' | 'createdAt' | 'modifiedAt'> & {
    readonly created: string;
    readonly modified: string;
  },
): Uint8Array {
  const fixed = new Uint8Array(52);
  const view = viewOf(fixed);
  view.setUint32(0, info.storageId, true);
  view.setUint16(4, info.format, true);
  view.setUint32(8, Math.min(info.size, SIZE_32_UNKNOWN), true);
  view.setUint32(26, info.width, true);
  view.setUint32(30, info.height, true);
  view.setUint32(38, info.parent, true);
  view.setUint16(42, info.format === FORMAT_ASSOCIATION ? 1 : 0, true);
  return concatBytes([
    fixed,
    encodePtpString(info.name),
    encodePtpString(info.created),
    encodePtpString(info.modified),
    encodePtpString(''),
  ]);
}

export function parseObjectInfo(payload: Uint8Array): ObjectInfo | null {
  if (payload.byteLength < 52) return null;
  const view = viewOf(payload);
  const name = readPtpString(payload, 52);
  const created = readPtpString(payload, name.next);
  const modified = readPtpString(payload, created.next);
  const size = view.getUint32(8, true);
  return {
    storageId: view.getUint32(0, true),
    format: view.getUint16(4, true),
    size,
    sizeKnown: size !== SIZE_32_UNKNOWN,
    width: view.getUint32(26, true),
    height: view.getUint32(30, true),
    parent: view.getUint32(38, true),
    name: name.text,
    createdAt: parsePtpDate(created.text),
    modifiedAt: parsePtpDate(modified.text),
  };
}

/** A UINT64 value dataset (GetObjectPropValue). Null when short or past 2^53. */
export function parseUint64(payload: Uint8Array): number | null {
  if (payload.byteLength < 8) return null;
  return safeUint64(viewOf(payload), 0);
}

/**
 * The UINT64 value of `prop` for `handle` in an ObjectPropList dataset: a count, then
 * (handle UINT32, property UINT16, datatype UINT16, value) per element. Stops at the
 * first element it can't step over (only UINT64 values have a known width here).
 */
export function parsePropListUint64(payload: Uint8Array, handle: number, prop: number): number | null {
  if (payload.byteLength < 4) return null;
  const view = viewOf(payload);
  const count = view.getUint32(0, true);
  let offset = 4;
  for (let index = 0; index < count && offset + 8 <= payload.byteLength; index += 1) {
    const owner = view.getUint32(offset, true);
    const code = view.getUint16(offset + 4, true);
    const type = view.getUint16(offset + 6, true);
    offset += 8;
    if (type !== DATATYPE_UINT64 || offset + 8 > payload.byteLength) return null;
    if (owner === handle && code === prop) return safeUint64(view, offset);
    offset += 8;
  }
  return null;
}

export function encodeUint64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  viewOf(out).setBigUint64(0, BigInt(value), true);
  return out;
}

function safeUint64(view: DataView, offset: number): number | null {
  const value = view.getBigUint64(offset, true);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function group(match: RegExpExecArray, index: number): number | null {
  const text = match[index];
  if (text === undefined) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
