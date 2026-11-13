// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ISO base media (MP4, QuickTime) boxes, for the metadata ffprobe doesn't pass on (LIB1-OEM): a track's own
 * `keys` (Apple's lens), and the boxes phones put in `udta` (Samsung's device name and model number). Pure over a
 * Buffer, so it is tested with bytes; `readMovieBox` is the one read from disk.
 */
import { open } from 'node:fs/promises';

export interface Box {
  readonly type: string;
  /** Where the box's header starts. */
  readonly start: number;
  /** Where the box's body starts (after its header) and where the box ends, in the buffer. */
  readonly body: number;
  readonly end: number;
}

/** The boxes between `start` and `end`. Stops at the first header that doesn't fit: the rest can't be trusted. */
export function childBoxes(buf: Buffer, start = 0, end = buf.length): Box[] {
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const big = buf.readBigUInt64BE(at + 8);
      if (big > BigInt(end - at)) break;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    boxes.push({
      type: buf.toString('latin1', at + 4, at + 8),
      start: at,
      body: at + header,
      end: at + size,
    });
    at += size;
  }
  return boxes;
}

export function findBox(buf: Buffer, parent: Pick<Box, 'body' | 'end'>, type: string): Box | undefined {
  return childBoxes(buf, parent.body, parent.end).find((box) => box.type === type);
}

/**
 * A `meta` box's children. QuickTime writes `meta` as a plain container; ISO writes it as a full box (four bytes
 * of version and flags first). Either way its first child is `hdlr`.
 */
export function metaChildren(buf: Buffer, meta: Box): Box[] {
  const plain = meta.body + 8 <= meta.end && buf.toString('latin1', meta.body + 4, meta.body + 8) === 'hdlr';
  return childBoxes(buf, plain ? meta.body : meta.body + 4, meta.end);
}

/** Well-known `data` types (QuickTime File Format, "Well-known types"). */
const UTF8 = 1;
const SIGNED_BE = 21;
const UNSIGNED_BE = 22;
const FLOAT32_BE = 23;
const FLOAT64_BE = 24;

/** One `data` value as text, numbers the way ffprobe prints them. Undefined for types Taalcut doesn't read. */
function dataValue(buf: Buffer, data: Box): string | undefined {
  if (data.end - data.body < 8) return undefined;
  const type = buf.readUInt32BE(data.body) & 0xff_ffff;
  const at = data.body + 8;
  const length = data.end - at;
  if (type === UTF8) return buf.toString('utf8', at, data.end).replace(/\0+$/, '');
  if (type === FLOAT32_BE && length === 4) return buf.readFloatBE(at).toFixed(6);
  if (type === FLOAT64_BE && length === 8) return buf.readDoubleBE(at).toFixed(6);
  if ((type === SIGNED_BE || type === UNSIGNED_BE) && length >= 1 && length <= 4) {
    const value = type === SIGNED_BE ? buf.readIntBE(at, length) : buf.readUIntBE(at, length);
    return String(value);
  }
  return undefined;
}

/** A `meta` box's `keys` paired with its `ilst` values: `{ 'com.apple.quicktime.camera.lens_model': '…' }`. */
export function metaKeys(buf: Buffer, meta: Box): Record<string, string> {
  const children = metaChildren(buf, meta);
  const keysBox = children.find((box) => box.type === 'keys');
  const list = children.find((box) => box.type === 'ilst');
  if (!keysBox || !list || keysBox.end - keysBox.body < 8) return {};
  const names: string[] = [];
  const count = buf.readUInt32BE(keysBox.body + 4);
  let at = keysBox.body + 8;
  for (let i = 0; i < count && at + 8 <= keysBox.end; i++) {
    const size = buf.readUInt32BE(at);
    if (size < 8 || at + size > keysBox.end) break;
    names.push(buf.toString('utf8', at + 8, at + size));
    at += size;
  }
  const out: Record<string, string> = {};
  for (const item of childBoxes(buf, list.body, list.end)) {
    // An item's type is its 1-based index into `keys`.
    const index = buf.readUInt32BE(item.start + 4);
    const name = names[index - 1];
    const data = findBox(buf, item, 'data');
    const value = data ? dataValue(buf, data) : undefined;
    if (name && value !== undefined && value !== '') out[name] = value;
  }
  return out;
}

/** A 3GPP text box (`auth`, `titl`): version and flags, a packed language code, then the text. */
export function threeGppText(buf: Buffer, box: Box): string | undefined {
  if (box.end - box.body < 7) return undefined;
  const at = box.body + 6;
  const utf16 = buf.readUInt16BE(at) === 0xfeff;
  const text = utf16 ? utf16be(buf.subarray(at + 2, box.end)) : buf.toString('utf8', at, box.end);
  return clean(text);
}

/** Big-endian UTF-16 text, from a copy: `swap16` works in place. */
function utf16be(bytes: Buffer): string {
  const copy = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)));
  return copy.swap16().toString('utf16le');
}

/** A QuickTime international text box (`©mak`, `©mod`): a 16-bit length, a 16-bit language, then the text. */
export function quickTimeText(buf: Buffer, box: Box): string | undefined {
  if (box.end - box.body < 4) return undefined;
  const length = buf.readUInt16BE(box.body);
  const at = box.body + 4;
  if (at + length > box.end) return undefined;
  return clean(buf.toString('utf8', at, at + length));
}

/** A box whose body is plain text (Samsung's `smta/mdln`). */
export function plainText(buf: Buffer, box: Box): string | undefined {
  return clean(buf.toString('utf8', box.body, box.end));
}

function clean(text: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- the padding phones leave is NULs and control bytes
  const trimmed = text.replace(/[\u0000-\u001f]+/g, ' ').trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A `moov` this big is a broken file or hours of samples; the metadata isn't worth the read. */
export const MAX_MOVIE_BOX_BYTES = 32 * 1024 * 1024;

/**
 * The file's `moov` box (header included), read from disk: the top-level headers are walked with small reads, so
 * a `moov` after the media data costs one seek. Undefined when there is none, it is too big, or the read fails.
 */
export async function readMovieBox(path: string): Promise<Buffer | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    const { size: fileSize } = await handle.stat();
    const header = Buffer.alloc(16);
    let at = 0;
    for (let boxes = 0; at + 8 <= fileSize && boxes < 64; boxes++) {
      const { bytesRead } = await handle.read(header, 0, 16, at);
      if (bytesRead < 8) return undefined;
      let size = header.readUInt32BE(0);
      if (size === 1 && bytesRead === 16) size = Number(header.readBigUInt64BE(8));
      else if (size === 0) size = fileSize - at;
      if (size < 8 || at + size > fileSize) return undefined;
      if (header.toString('latin1', 4, 8) === 'moov') {
        if (size > MAX_MOVIE_BOX_BYTES) return undefined;
        const movie = Buffer.alloc(size);
        const read = await handle.read(movie, 0, size, at);
        return read.bytesRead === size ? movie : undefined;
      }
      at += size;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
