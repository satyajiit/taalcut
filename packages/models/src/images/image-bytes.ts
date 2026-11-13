// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a provider sent back, read from the bytes themselves rather than from what it says: the media type
 * from the file's signature and the pixel size from its header (PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X).
 * Nothing is decoded or re-encoded: the bytes reach the library unchanged.
 */
import type { ImageAspect, ImageMediaType } from './image-types';

export interface ImageFacts {
  readonly mediaType: ImageMediaType;
  readonly width: number;
  readonly height: number;
}

/** Smallest short side accepted as a usable still. */
export const MIN_IMAGE_SIDE = 256;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  prefix.every((value, i) => bytes[at + i] === value);
const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));
const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 65_536 + u16be(b, at + 2);
const byte = (b: Uint8Array, at: number) => b[at] ?? 0;

/** The image's type and size, or undefined for anything that isn't a PNG, JPEG or WebP we can read. */
export function imageFacts(bytes: Uint8Array): ImageFacts | undefined {
  if (startsWith(bytes, PNG) && ascii(bytes, 12, 4) === 'IHDR') {
    return sized('image/png', u32be(bytes, 16), u32be(bytes, 20));
  }
  if (startsWith(bytes, [0xff, 0xd8])) return jpegFacts(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webpFacts(bytes);
  return undefined;
}

function sized(mediaType: ImageMediaType, width: number, height: number): ImageFacts | undefined {
  return width > 0 && height > 0 ? { mediaType, width, height } : undefined;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegFacts(bytes: Uint8Array): ImageFacts | undefined {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (byte(bytes, at) !== 0xff) return undefined;
    const marker = byte(bytes, at + 1);
    // Fill bytes and markers without a length.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += marker === 0xff ? 1 : 2;
      continue;
    }
    if (SOF.has(marker)) return sized('image/jpeg', u16be(bytes, at + 7), u16be(bytes, at + 5));
    const length = u16be(bytes, at + 2);
    if (length < 2) return undefined;
    at += 2 + length;
  }
  return undefined;
}

function webpFacts(b: Uint8Array): ImageFacts | undefined {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    return sized('image/webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    const width = 1 + (((byte(b, 22) & 0x3f) << 8) | byte(b, 21));
    const height = 1 + (((byte(b, 24) & 0x0f) << 10) | (byte(b, 23) << 2) | ((byte(b, 22) & 0xc0) >> 6));
    return sized('image/webp', width, height);
  }
  if (chunk === 'VP8X') {
    const width = 1 + (byte(b, 24) | (byte(b, 25) << 8) | (byte(b, 26) << 16));
    const height = 1 + (byte(b, 27) | (byte(b, 28) << 8) | (byte(b, 29) << 16));
    return sized('image/webp', width, height);
  }
  return undefined;
}

const u16le = (b: Uint8Array, at: number) => byte(b, at) | (byte(b, at + 1) << 8);

/**
 * Whether a still fits the aspect asked for: the right orientation (providers round 9:16 to the nearest
 * size they make, e.g. OpenAI's 1024×1536), a square within 10 %, and a usable short side.
 */
export function fitsAspect(facts: Pick<ImageFacts, 'width' | 'height'>, aspect: ImageAspect): boolean {
  const { width, height } = facts;
  if (Math.min(width, height) < MIN_IMAGE_SIDE) return false;
  switch (aspect) {
    case '9:16':
    case '4:5':
      return height > width;
    case '16:9':
      return width > height;
    case '1:1':
      return Math.abs(width - height) / Math.max(width, height) <= 0.1;
  }
}

/** File extension for a media type (the library's file name). */
export function imageExtension(mediaType: ImageMediaType): 'png' | 'jpg' | 'webp' {
  return mediaType === 'image/png' ? 'png' : mediaType === 'image/jpeg' ? 'jpg' : 'webp';
}

/** Base64 to bytes; undefined for text that isn't base64. */
export function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (clean.length === 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) return undefined;
  return new Uint8Array(Buffer.from(clean, 'base64'));
}
