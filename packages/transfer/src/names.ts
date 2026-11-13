// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { TRANSFER_LIMITS } from './limits';

const VIDEO_BRANDS = new Set([
  'qt',
  'isom',
  'mp41',
  'mp42',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'm4v',
  'm4vh',
  'msnv',
  'avc1',
  'dash',
  '3gp4',
  '3gp5',
  '3gp6',
  '3g2a',
  '3gp',
]);
const IMAGE_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1']);
const AUDIO_BRANDS = new Set(['m4a', 'm4b', 'm4p']);

export type SniffedKind = 'video' | 'image' | 'audio';

/**
 * The fingerprint the phone and `POST /api/uploads/lookup` share.
 * `lastModified` is the phone's `File.lastModified`.
 */
export function fileFingerprint(file: {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number | null;
  readonly type: string;
}): string {
  return `${file.name}\n${file.size}\n${file.lastModified ?? ''}\n${file.type}`;
}

/** The extension only, for logs. Never the file name. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
}

/** Display-safe name: NFC, no separators or control characters, at most 255 bytes. Never a path. */
export function sanitiseFileName(name: string): string {
  const normalised = name.normalize('NFC');
  let cleaned = '';
  for (const char of normalised) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    if (char === '/' || char === '\\' || char === ':' || char === '\u0000') continue;
    cleaned += char;
  }
  cleaned = cleaned.replace(/^\.+/, '').trim();
  if (cleaned.length === 0) cleaned = 'video';
  const bytes = Buffer.from(cleaned, 'utf8');
  if (bytes.length <= TRANSFER_LIMITS.maxNameBytes) return cleaned;
  let end = TRANSFER_LIMITS.maxNameBytes;
  while (end > 0 && (bytes[end - 1]! & 0xc0) === 0x80) end -= 1;
  const cut = bytes.subarray(0, end).toString('utf8');
  return cut.length > 0 ? cut : 'video';
}

/** `video`, `image`, `audio`, or null from the first 64 KiB. */
export function sniffMediaType(bytes: Uint8Array): SniffedKind | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).trim().toLowerCase();
    if (IMAGE_BRANDS.has(brand)) return 'image';
    if (AUDIO_BRANDS.has(brand)) return 'audio';
    if (VIDEO_BRANDS.has(brand) || brand.startsWith('3gp')) return 'video';
    return null;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'image';
  if (isTiff(bytes)) return 'image';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') return 'audio';
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') return 'audio';
  if (isMp3Frame(bytes)) return 'audio';
  return null;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

function isTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
  return le || be;
}

function isMp3Frame(bytes: Uint8Array): boolean {
  if (bytes.length < 2 || bytes[0] !== 0xff) return false;
  const next = bytes[1]!;
  return (next & 0xe0) === 0xe0;
}
