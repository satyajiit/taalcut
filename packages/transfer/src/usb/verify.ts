// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * After a pull: size, sniff, source hash, and probe versus the listing.
 * The Wi-Fi user-agent check does not run on a cable import.
 */
import { open, stat } from 'node:fs/promises';
import type { ReencodeCheck } from '@taalcut/core';
import type { ProbeResult } from '@taalcut/media';
import { TRANSFER_LIMITS } from '../limits';
import { fileExtension, sniffMediaType, type SniffedKind } from '../names';
import { normaliseProbe } from '../handoff/probe';
import type { TransferMedia } from '../deps';
import type { ReencodeProbe } from '../reencode';
import type { DeviceItem } from './bridge';

/** When the probe has no frame rate (a still, or an odd container), the slowest common rate: 24 fps. */
const FALLBACK_FRAME_MS = 1000 / 24;
/** Listings round durations to whole milliseconds. */
const ROUNDING_MS = 1;

export interface VerifyInput {
  readonly item: DeviceItem;
  readonly path: string;
  readonly sha256: string;
  readonly sourceSha256: string | null;
  readonly media: TransferMedia;
  readonly signal: AbortSignal;
}

export type VerifyVerdict =
  | { readonly kind: 'ok'; readonly reencode: ReencodeCheck; readonly placeholder: boolean }
  | { readonly kind: 'short'; readonly placeholder: boolean }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'hash' };

export async function verifyItem(input: VerifyInput): Promise<VerifyVerdict> {
  const size = await fileSize(input.path);
  const header = await readHeader(input.path);
  const sniffed = header ? sniffMediaType(header) : null;
  const probed = await probeFile(input.media, input.path, input.signal);
  const placeholder = header ? isPlaceholderBody(input.item, header, probed.probe) : false;
  if (size === null || size !== input.item.sizeBytes) return { kind: 'short', placeholder };
  if (!sniffed || sniffed !== input.item.kind) return { kind: 'rejected' };
  if (input.sourceSha256 && input.sourceSha256.toLowerCase() !== input.sha256.toLowerCase())
    return { kind: 'hash' };
  return { kind: 'ok', reencode: reencodeFor(input.item, header, probed), placeholder };
}

export function isPlaceholderBody(
  item: DeviceItem,
  header: Uint8Array,
  probe: ReencodeProbe | null,
): boolean {
  const listed = listedFamily(item);
  if (listed !== 'heic' && listed !== 'hevc') return false;
  return bodyFamily(header, probe) === 'jpeg' || bodyFamily(header, probe) === 'h264';
}

async function probeFile(
  media: TransferMedia,
  path: string,
  signal: AbortSignal,
): Promise<{
  readonly failed: boolean;
  readonly probe: ReencodeProbe | null;
  readonly media: ProbeResult | null;
}> {
  try {
    const result = await media.probe(path, { signal });
    if (isFailedProbe(result)) return { failed: true, probe: null, media: null };
    if (isMediaProbe(result)) return { failed: false, probe: normaliseProbe(result), media: result };
    return { failed: false, probe: normaliseProbe(result), media: null };
  } catch {
    return { failed: true, probe: null, media: null };
  }
}

function reencodeFor(
  item: DeviceItem,
  header: Uint8Array | null,
  probed: {
    readonly failed: boolean;
    readonly probe: ReencodeProbe | null;
    readonly media: ProbeResult | null;
  },
): ReencodeCheck {
  const body = header ? bodyFamily(header, probed.probe) : 'other';
  const listed = listedFamily(item);
  const mismatch =
    (listed === 'heic' || listed === 'hevc' || listed === 'prores') && (body === 'jpeg' || body === 'h264');
  if (mismatch) return { verdict: 'likely', reasons: ['device-converted'] };
  if (probed.failed || !probed.probe) return { verdict: 'unknown', reasons: [] };
  // SPEC step 6: size or length unlike the listing means the device sent a converted copy.
  if (listingDisagrees(item, probed.media)) return { verdict: 'likely', reasons: ['device-converted'] };
  return { verdict: 'unlikely', reasons: [] };
}

/**
 * Width and height are compared for videos only: a HEIC still's first stream
 * can be one tile of its grid, and a converted still is caught by its codec.
 */
function listingDisagrees(item: DeviceItem, media: ProbeResult | null): boolean {
  if (!media) return false;
  if (item.kind === 'video' && item.width !== null && item.height !== null) {
    const pairs: Array<[number, number]> = [];
    if (media.video) {
      pairs.push(
        [media.video.width, media.video.height],
        [media.video.displayWidth, media.video.displayHeight],
      );
    }
    const listedPixels = item.width * item.height;
    if (
      pairs.length > 0 &&
      !pairs.some(([width, height]) => orientations(item.width, item.height, width, height)) &&
      pairs.every(([width, height]) => width * height < listedPixels)
    ) {
      return true;
    }
  }
  if (item.durationMs !== null && media.duration && media.duration.rate !== 0) {
    const duration = (media.duration.value / media.duration.rate) * 1000;
    if (Math.abs(duration - item.durationMs) > frameMs(media) + ROUNDING_MS) return true;
  }
  return false;
}

/** One frame at the clip's average rate (phone video is variable; r_frame_rate is only a time base). */
function frameMs(media: ProbeResult): number {
  const rate = media.video?.averageFrameRate ?? media.video?.frameRate;
  if (!rate || rate.num <= 0 || rate.den <= 0) return FALLBACK_FRAME_MS;
  return (1000 * rate.den) / rate.num;
}

function orientations(aW: number | null, aH: number | null, bW: number, bH: number): boolean {
  if (aW === null || aH === null) return true;
  return (aW === bW && aH === bH) || (aW === bH && aH === bW);
}

type Family = 'heic' | 'hevc' | 'prores' | 'jpeg' | 'h264' | 'other';

function listedFamily(item: DeviceItem): Family {
  if (item.flags.prores) return 'prores';
  const type = (item.type ?? '').toLowerCase();
  const ext = fileExtension(item.name);
  if (ext === 'heic' || ext === 'heif' || type.includes('heic') || type.includes('heif')) return 'heic';
  if (type.includes('prores') || ext === 'prores') return 'prores';
  if (type.includes('hevc') || type.includes('hvc1') || type.includes('h265') || ext === 'hevc')
    return 'hevc';
  return 'other';
}

function bodyFamily(header: Uint8Array, probe: ReencodeProbe | null): Family {
  if (isJpeg(header)) return 'jpeg';
  const brand = ftypBrand(header);
  if (
    brand === 'heic' ||
    brand === 'heix' ||
    brand === 'heif' ||
    brand === 'hevc' ||
    brand === 'hevx' ||
    brand === 'mif1'
  ) {
    return 'heic';
  }
  const codec = (probe?.videoCodec ?? '').toLowerCase();
  if (codec.includes('prores')) return 'prores';
  if (codec === 'hevc' || codec === 'h265' || codec === 'hvc1') return 'hevc';
  if (codec === 'h264' || codec === 'avc' || codec === 'avc1' || codec.includes('h264')) return 'h264';
  if (brand === 'avc1') return 'h264';
  return 'other';
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function ftypBrand(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 4, 8) !== 'ftyp') return null;
  return ascii(bytes, 8, 12).trim().toLowerCase();
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

function isFailedProbe(value: unknown): value is { readonly ok: false } {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

function isMediaProbe(value: object): value is ProbeResult {
  return 'container' in value && 'streams' in value;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

async function readHeader(path: string): Promise<Uint8Array | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const buf = Buffer.alloc(TRANSFER_LIMITS.sniffBytes);
    const read = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, read.bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export type { SniffedKind };
