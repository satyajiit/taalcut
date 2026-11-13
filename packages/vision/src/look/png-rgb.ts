// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 8-bit PNG decoding: ffmpeg stills use filter Sub; gray, gray+alpha, RGB and
 * RGBA, filters 0–4, and several IDAT chunks are accepted too. Palette and
 * interlace are refused. The bytes are not kept past the caller.
 * `decodePngPixels` keeps the PNG's own channels; `decodePngRgb` packs RGB.
 */
import { crc32, inflateSync } from 'node:zlib';
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import { PNG_SIGNATURE as SIGNATURE } from '../media/png';

/** Longest side a look still may have. ffmpeg is asked for 480; this is the decoder's ceiling. */
const MAX_EDGE = 8192;
/** PNG colour type → samples per pixel: gray, RGB, gray+alpha, RGBA. Palette (3) is refused. */
const CHANNELS: Readonly<Partial<Record<number, number>>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

/** Unfiltered samples, row-major, `channels` per pixel (1 gray, 2 gray+alpha, 3 RGB, 4 RGBA). */
export interface DecodedPngPixels {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly pixels: Uint8Array;
}

interface Header {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

function fail(detail: string): Result<never> {
  return err(ValidationError({ field: 'png' }, { detail }));
}

/** Four bytes at `offset`, or undefined past the end. */
function quad(bytes: Uint8Array, offset: number): readonly [number, number, number, number] | undefined {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
  return [a, b, c, d];
}

function u32(bytes: Uint8Array, offset: number): number | undefined {
  const four = quad(bytes, offset);
  return four ? (four[0] * 0x1000000 + four[1] * 0x10000 + four[2] * 0x100 + four[3]) >>> 0 : undefined;
}

function ascii(bytes: Uint8Array, offset: number): string | undefined {
  const four = quad(bytes, offset);
  return four ? String.fromCharCode(...four) : undefined;
}

function readHeader(body: Uint8Array): Result<Header> {
  const width = u32(body, 0);
  const height = u32(body, 4);
  const [depth, color, compression, filterMethod, interlace] = [
    body[8],
    body[9],
    body[10],
    body[11],
    body[12],
  ];
  if (
    width === undefined ||
    height === undefined ||
    depth === undefined ||
    color === undefined ||
    compression === undefined ||
    filterMethod === undefined ||
    interlace === undefined
  ) {
    return fail('short IHDR');
  }
  if (depth !== 8) return fail('only 8-bit png');
  if (compression !== 0 || filterMethod !== 0) return fail('unsupported png method');
  if (interlace !== 0) return fail('interlaced png');
  const channels = CHANNELS[color];
  if (channels === undefined) return fail('palette or unknown colour type');
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) return fail('png size');
  return ok({ width, height, channels });
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  if (toUp <= toUpLeft) return up;
  return upLeft;
}

function predictor(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paeth(left, up, upLeft);
  return 0;
}

function unfilter(raw: Uint8Array, header: Header): Result<Uint8Array> {
  const { width, height, channels } = header;
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return fail('short image data');
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter === undefined || filter > 4) return fail('unknown filter');
    const inRow = y * (stride + 1) + 1;
    const outRow = y * stride;
    const prior = outRow - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (out[outRow + x - channels] ?? 0) : 0;
      const up = y > 0 ? (out[prior + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (out[prior + x - channels] ?? 0) : 0;
      out[outRow + x] = ((raw[inRow + x] ?? 0) + predictor(filter, left, up, upLeft)) & 0xff;
    }
  }
  return ok(out);
}

function toRgb(decoded: DecodedPngPixels): Uint8Array {
  const { width, height, channels, pixels } = decoded;
  const rgb = new Uint8Array(width * height * 3);
  const gray = channels <= 2;
  for (let i = 0; i < width * height; i += 1) {
    const sample = pixels[i * channels] ?? 0;
    rgb[i * 3] = sample;
    rgb[i * 3 + 1] = gray ? sample : (pixels[i * channels + 1] ?? 0);
    rgb[i * 3 + 2] = gray ? sample : (pixels[i * channels + 2] ?? 0);
  }
  return rgb;
}

function signatureOk(bytes: Uint8Array): boolean {
  if (bytes.length < SIGNATURE.length) return false;
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) return false;
  }
  return true;
}

interface Chunks {
  readonly header: Header;
  readonly idats: readonly Uint8Array[];
}

/** Walks the chunks to IEND: checks every crc, IHDR first, IDAT contiguous, no unknown critical chunk. */
function readChunks(bytes: Uint8Array): Result<Chunks> {
  let offset = SIGNATURE.length;
  let header: Header | undefined;
  let idatOpen = false;
  let idatDone = false;
  const idats: Uint8Array[] = [];
  for (;;) {
    const length = u32(bytes, offset);
    const type = ascii(bytes, offset + 4);
    if (length === undefined || type === undefined || offset + 12 + length > bytes.length) {
      return fail('truncated chunk');
    }
    const crc = u32(bytes, offset + 8 + length);
    if (crc === undefined || crc32(bytes.subarray(offset + 4, offset + 8 + length)) >>> 0 !== crc) {
      return fail('bad crc');
    }
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      if (header) return fail('repeated IHDR');
      const read = readHeader(body);
      if (!read.ok) return read;
      header = read.value;
    } else if (!header) {
      return fail('IHDR is not first');
    } else if (type === 'IDAT') {
      if (idatDone) return fail('split IDAT');
      idatOpen = true;
      idats.push(body);
    } else if (type === 'IEND') {
      return idats.length > 0 ? ok({ header, idats }) : fail('no image data');
    } else if (type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90 && type !== 'PLTE') {
      // An upper-case first letter marks a critical chunk this decoder does not know.
      return fail(`unknown critical chunk ${type}`);
    } else if (idatOpen) {
      idatDone = true;
    }
  }
}

/** The PNG's own samples, unfiltered. */
export function decodePngPixels(bytes: Uint8Array): Result<DecodedPngPixels> {
  if (!signatureOk(bytes)) return fail('not a png');
  const chunks = readChunks(bytes);
  if (!chunks.ok) return chunks;
  const { header, idats } = chunks.value;
  const packed = new Uint8Array(idats.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of idats) {
    packed.set(part, at);
    at += part.length;
  }
  let inflated: Uint8Array;
  try {
    inflated = inflateSync(packed);
  } catch {
    return fail('bad image data');
  }
  const pixels = unfilter(inflated, header);
  if (!pixels.ok) return pixels;
  return ok({ width: header.width, height: header.height, channels: header.channels, pixels: pixels.value });
}

/** Packed RGB, row-major. Alpha is dropped. Gray is expanded. */
export function decodePngRgb(bytes: Uint8Array): Result<DecodedPng> {
  const decoded = decodePngPixels(bytes);
  if (!decoded.ok) return decoded;
  return ok({ width: decoded.value.width, height: decoded.value.height, rgb: toRgb(decoded.value) });
}
