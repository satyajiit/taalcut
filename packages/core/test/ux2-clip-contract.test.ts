// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** UX2 (clip lane): what the clip page plays, hears and says about the file; Finder for its original. */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  assetDetailSchema,
  FILMSTRIP_MAX_FRAMES,
  filesContract,
  filmstripSchema,
  mediaFactsSchema,
  newId,
  ORIGINAL_MEDIA_KEY_PATTERN,
  playbackSchema,
  playbackUrl,
  waveformSummarySchema,
} from '@taalcut/core';

const assetId = newId<'Asset'>();
const HASH = 'ab'.repeat(32);
const proxy = {
  kind: 'proxy',
  key: `proxies/ab/${HASH}.v1.mp4`,
  bytes: 912_000,
  mimeType: 'video/mp4',
  width: 720,
  height: 1280,
  duration: { value: 183, rate: { num: 30, den: 1 } },
  frameRate: { num: 30, den: 1 },
  recipe: 1,
} as const;

const detail = {
  asset: {
    id: assetId,
    kind: 'video',
    name: 'IMG_0001.MOV',
    capturedAt: null,
    addedAt: 1_760_000_000_000,
    duration: { value: 183, rate: { num: 30, den: 1 } },
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    availability: 'online',
    sourceIds: [newId<'Source'>()],
    description: null,
    quality: null,
    shotCount: 0,
    language: null,
    index: { state: 'done', done: 14, total: 14 },
    thumbnail: null,
    reencode: null,
    trashed: false,
    provenance: { kind: 'captured' },
  },
  facts: null,
  shots: [],
  transcript: null,
  locations: [],
  reencodeReasons: [],
  stages: [],
  playback: null,
  filmstrip: null,
  waveform: null,
  beats: null,
  sizeBytes: 48_213_004,
};

const at = (value: number) => ({ value, rate: { num: 30, den: 1 } });
const filmstrip = {
  file: {
    kind: 'filmstrip',
    key: `filmstrips/ab/${HASH}.v2.jpg`,
    bytes: 96_000,
    mimeType: 'image/jpeg',
    width: 864,
    height: 1536,
    recipe: 2,
  },
  columns: 8,
  rows: 8,
  tileWidth: 108,
  tileHeight: 192,
  times: [at(0), at(91), at(182)],
} as const;

describe('the clip page’s additions to the asset detail', () => {
  it('always states them: an answer without them doesn’t parse', () => {
    expect(assetDetailSchema.safeParse(detail).success).toBe(true);
    for (const field of ['playback', 'filmstrip', 'waveform', 'beats', 'sizeBytes'] as const) {
      const { [field]: _left, ...without } = detail;
      expect(assetDetailSchema.safeParse(without).success).toBe(false);
    }
    expect(assetDetailSchema.safeParse({ ...detail, sizeBytes: null }).success).toBe(false);
  });

  it('carries the proxy to play, the sound, the beats and the file size', () => {
    const parsed = assetDetailSchema.parse({
      ...detail,
      playback: { source: 'proxy', file: proxy },
      waveform: { bucketsPerSecond: 50, peaks: [0, 0.25, 1] },
      beats: {
        rate: { num: 1000, den: 1 },
        beats: [{ value: 500, rate: { num: 1000, den: 1 } }],
        downbeats: [0],
        bpm: 120,
        beatsPerBar: 4,
        confidence: 0.8,
        source: 'tracker',
      },
    });
    expect(parsed.playback?.source === 'proxy' && parsed.playback.file.key).toBe(proxy.key);
    expect(parsed.waveform?.peaks).toEqual([0, 0.25, 1]);
    expect(parsed.beats?.bpm).toBe(120);
    expect(parsed.sizeBytes).toBe(48_213_004);
  });

  it('carries the filmstrip: a sprite of frames evenly spaced in time, and their times', () => {
    const parsed = assetDetailSchema.parse({ ...detail, filmstrip });
    expect(parsed.filmstrip?.file.key).toBe(filmstrip.file.key);
    expect(parsed.filmstrip?.times.map((time) => time.value)).toEqual([0, 91, 182]);
  });

  it('takes only a JPEG filmstrip sprite whose cells hold its frames', () => {
    const proxyFile = { ...filmstrip, file: proxy };
    expect(filmstripSchema.safeParse(proxyFile).success).toBe(false);
    const json = { ...filmstrip.file, key: `filmstrips/ab/${HASH}.layout.v1.json`, mimeType: 'application/json' };
    expect(filmstripSchema.safeParse({ ...filmstrip, file: json }).success).toBe(false);
    expect(filmstripSchema.safeParse({ ...filmstrip, columns: 1, rows: 2 }).success).toBe(false);
    expect(filmstripSchema.safeParse({ ...filmstrip, times: [] }).success).toBe(false);
    const many = Array.from({ length: FILMSTRIP_MAX_FRAMES + 1 }, (_, i) => at(i));
    expect(filmstripSchema.safeParse({ ...filmstrip, columns: 9, rows: 9, times: many }).success).toBe(false);
  });

  it('plays a proxy copy, or the original that is its own proxy, each from the media host', () => {
    const copy = playbackSchema.parse({ source: 'proxy', file: proxy });
    expect(playbackUrl(assetId, copy)).toBe(`app://media/${proxy.key}`);
    const original = playbackSchema.parse({
      source: 'original',
      width: 720,
      height: 1280,
      duration: proxy.duration,
      frameRate: proxy.frameRate,
    });
    const url = playbackUrl(assetId, original);
    expect(url).toBe(`app://media/originals/${assetId}`);
    expect(ORIGINAL_MEDIA_KEY_PATTERN.test(url.slice('app://media/'.length))).toBe(true);
    expect(ORIGINAL_MEDIA_KEY_PATTERN.test('originals/../../etc/passwd')).toBe(false);
  });

  it('plays only a proxy file, and keeps the sound and the size in range', () => {
    const thumbnail = { ...proxy, kind: 'thumbnail', key: `thumbnails/ab/${HASH}.v1.jpg`, mimeType: 'image/jpeg' };
    expect(playbackSchema.safeParse({ source: 'proxy', file: thumbnail }).success).toBe(false);
    expect(playbackSchema.safeParse({ source: 'original', width: 720, height: 1280 }).success).toBe(false);
    expect(assetDetailSchema.safeParse({ ...detail, sizeBytes: -1 }).success).toBe(false);
    expect(waveformSummarySchema.safeParse({ bucketsPerSecond: 50, peaks: [1.5] }).success).toBe(false);
    expect(waveformSummarySchema.safeParse({ bucketsPerSecond: 0, peaks: [] }).success).toBe(false);
    expect(
      waveformSummarySchema.safeParse({ bucketsPerSecond: 1, peaks: Array.from({ length: 4001 }, () => 0) })
        .success,
    ).toBe(false);
  });
});

describe('the codecs and bit depth in a clip’s facts', () => {
  const facts = {
    version: 1,
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    variableFrameRate: false,
    hdr: 'hlg',
    speed: 'normal',
    speedFactor: 1,
    retimedInFile: false,
    hasAudio: true,
  };

  it('are short names and a whole number of bits, left out only when there is nothing to name', () => {
    expect(mediaFactsSchema.parse(facts).videoCodec).toBeUndefined();
    const full = mediaFactsSchema.parse({ ...facts, videoCodec: 'hevc', audioCodec: 'aac', bitDepth: 10 });
    expect([full.videoCodec, full.audioCodec, full.bitDepth]).toEqual(['hevc', 'aac', 10]);
    expect(mediaFactsSchema.safeParse({ ...facts, bitDepth: 10.5 }).success).toBe(false);
    expect(mediaFactsSchema.safeParse({ ...facts, videoCodec: 'x'.repeat(33) }).success).toBe(false);
  });
});

describe('files.revealAsset', () => {
  it('takes an asset id, nothing else', () => {
    const input = filesContract.revealAsset['~orpc'].inputSchema as z.ZodType;
    expect(input.safeParse({ assetId }).success).toBe(true);
    expect(input.safeParse({ assetId: 'not-an-id' }).success).toBe(false);
    expect(input.safeParse({ path: '/Users/me/IMG_0001.MOV' }).success).toBe(false);
  });
});
