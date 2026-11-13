// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Waveform peaks for canvas drawing. Little-endian header (version, buckets
 * per second, count) then int16 min/max pairs. Not a picture: the renderer
 * draws the bars itself.
 */
export const WAVEFORM_VERSION = 1;
export const WAVEFORM_BUCKETS_PER_SEC = 100;

export function encodeWaveformPeaks(
  samples: Int16Array,
  sampleRate = 8000,
  bucketsPerSec = WAVEFORM_BUCKETS_PER_SEC,
): Buffer {
  const perBucket = Math.max(1, Math.round(sampleRate / bucketsPerSec));
  const count = Math.max(1, Math.ceil(samples.length / perBucket));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(WAVEFORM_VERSION, 0);
  header.writeUInt32LE(bucketsPerSec, 4);
  header.writeUInt32LE(count, 8);
  const body = Buffer.alloc(count * 4);
  for (let index = 0; index < count; index++) {
    let min = 0;
    let max = 0;
    const from = index * perBucket;
    const to = Math.min(samples.length, from + perBucket);
    if (from < to) {
      min = samples[from] ?? 0;
      max = min;
      for (let sample = from; sample < to; sample++) {
        const value = samples[sample] ?? 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    body.writeInt16LE(min, index * 4);
    body.writeInt16LE(max, index * 4 + 2);
  }
  return Buffer.concat([header, body]);
}

export function decodeWaveformHeader(
  body: Buffer,
): { version: number; bucketsPerSec: number; count: number } | undefined {
  if (body.length < 12) return undefined;
  return {
    version: body.readUInt32LE(0),
    bucketsPerSec: body.readUInt32LE(4),
    count: body.readUInt32LE(8),
  };
}

/** The most buckets a waveform summary carries (core's waveformSummarySchema). */
export const WAVEFORM_SUMMARY_MAX = 4000;

/**
 * A waveform file in brief, for the clip page's sound lane (UX2): each bucket's loudest sample as 0 to 1, merged
 * down to at most `maxBuckets` (a long clip is summarised more coarsely). Undefined for a file that isn't a
 * version-1 waveform or is cut short.
 */
export function summariseWaveformPeaks(
  body: Buffer,
  maxBuckets = 1200,
): { bucketsPerSecond: number; peaks: number[] } | undefined {
  const header = decodeWaveformHeader(body);
  if (!header || header.version !== WAVEFORM_VERSION || header.bucketsPerSec <= 0) return undefined;
  if (body.length < 12 + header.count * 4) return undefined;
  const limit = Math.max(1, Math.min(WAVEFORM_SUMMARY_MAX, Math.floor(maxBuckets)));
  const merge = Math.max(1, Math.ceil(header.count / limit));
  const peaks: number[] = [];
  for (let start = 0; start < header.count; start += merge) {
    let loudest = 0;
    for (let index = start; index < Math.min(header.count, start + merge); index++) {
      const min = body.readInt16LE(12 + index * 4);
      const max = body.readInt16LE(12 + index * 4 + 2);
      loudest = Math.max(loudest, Math.abs(min) / 32768, max / 32767);
    }
    peaks.push(Math.round(Math.min(1, loudest) * 1000) / 1000);
  }
  return { bucketsPerSecond: header.bucketsPerSec / merge, peaks };
}
