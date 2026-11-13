// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample sources and file names: data, never translated */

/**
 * The fake library's clips and sources: by default 5,000 clips over four
 * sources, generated from a seed (no fixture file). A creator's mix: mostly
 * vertical phone video, some horizontal drone and action-camera footage, a
 * few stills; speech in English, Hindi, Spanish and Brazilian Portuguese; a
 * drive that's unplugged; a phone import still being looked through; a few
 * files that couldn't be read.
 */
import type { AssetSummary, DerivedFileRef, Id, SourceView } from '@taalcut/core';
import { FILE_PATTERNS, SCENES, SPEECH } from './scenes';
import { fakeUlid, pick, prng, sceneHash } from './seed';
import { doneAfter, FAKE_STAGES, SEARCHABLE_STAGES } from './stages';

/** Entity numbers for fakeUlid. */
export const KIND = { asset: 1, source: 2, shot: 3, location: 4 } as const;

export const DEFAULT_ASSET_COUNT = 5000;
/** The newest phone clips are still being looked through. */
export const INDEXING_TAIL = 120;
const DAY = 86_400_000;
/** "Now" for the fixture: a fixed instant, so dates in screenshots don't move. */
export const FIXTURE_NOW = Date.UTC(2026, 9, 13, 9, 30);

export interface FakeSource extends SourceView {
  readonly volume: string | null;
}

export function fakeSources(): FakeSource[] {
  const base = {
    watch: true,
    scan: { state: 'idle' as const, lastScanAt: FIXTURE_NOW - DAY },
    missing: 0,
  };
  return [
    {
      ...base,
      id: fakeUlid<'Source'>(KIND.source, 1),
      kind: 'wifi_import',
      name: 'iPhone 16 Pro',
      status: 'online',
      path: null,
      watch: false,
      assets: 0,
      createdAt: FIXTURE_NOW - 400 * DAY,
      volume: null,
    },
    {
      ...base,
      id: fakeUlid<'Source'>(KIND.source, 2),
      kind: 'watched_folder',
      name: 'Goa trip',
      status: 'online',
      path: '/Users/me/Movies/Goa trip',
      assets: 0,
      createdAt: FIXTURE_NOW - 30 * DAY,
      volume: 'Macintosh HD',
    },
    {
      ...base,
      id: fakeUlid<'Source'>(KIND.source, 3),
      kind: 'watched_folder',
      name: 'Samsung T7',
      status: 'offline',
      path: '/Volumes/Samsung T7/Footage',
      assets: 0,
      createdAt: FIXTURE_NOW - 300 * DAY,
      volume: 'Samsung T7',
    },
    {
      ...base,
      id: fakeUlid<'Source'>(KIND.source, 4),
      kind: 'watched_folder',
      name: 'Desktop clips',
      status: 'online',
      path: '/Users/me/Desktop/clips',
      assets: 0,
      createdAt: FIXTURE_NOW - 90 * DAY,
      volume: 'Macintosh HD',
    },
  ];
}

/** What the generator decided about a clip beyond its summary: the scene and the speech. */
export interface FakeAssetExtras {
  readonly n: number;
  readonly scene: number;
  readonly speech: number | null;
  readonly frameRate: { readonly num: number; readonly den: number };
  /** Why its analysis stopped, when the fake says (the import's unreadable files: import-failures.ts). */
  readonly failure?: { readonly code: string; readonly messageKey: string; readonly retryable: boolean };
}

export interface FakeAsset {
  readonly summary: AssetSummary;
  readonly extras: FakeAssetExtras;
}

function thumbnail(n: number, scene: number, width: number, height: number): DerivedFileRef {
  const hash = sceneHash(scene, n, 1);
  return {
    kind: 'thumbnail',
    key: `thumbnails/${hash.slice(0, 2)}/${hash}.v1.jpg`,
    bytes: 18_000 + (n % 9000),
    mimeType: 'image/jpeg',
    width,
    height,
    recipe: 1,
  };
}

const SHAPES = [
  { orientation: 'portrait', width: 1080, height: 1920, weight: 0.68 },
  { orientation: 'landscape', width: 1920, height: 1080, weight: 0.27 },
  { orientation: 'square', width: 1080, height: 1080, weight: 0.05 },
] as const;

const RATES = [
  { num: 30, den: 1 },
  { num: 60, den: 1 },
  { num: 30000, den: 1001 },
  { num: 25, den: 1 },
] as const;

/**
 * Source by age: the phone is everywhere, the trip is recent, the drive is old; the newest clips are the phone
 * import still being looked through (the import strip and the card follow it).
 */
function sourceOf(age: number, importing: boolean, sources: readonly FakeSource[], random: () => number) {
  const [phone, trip, drive, other] = sources;
  const source = importing ? phone : age > 0.8 ? trip : age < 0.25 ? drive : random() < 0.75 ? phone : other;
  if (!source) throw new Error('the fake library has four sources');
  return source;
}

/** One clip, the same every time for the same n. */
export function fakeAsset(n: number, count: number, sources: readonly FakeSource[]): FakeAsset {
  const random = prng(n * 2_654_435_761 + 11);
  const scene = Math.floor(random() * SCENES.length);
  const age = n / count;
  // In a library bigger than the import, its newest clips are the import's.
  const source = sourceOf(age, count > INDEXING_TAIL && n >= count - INDEXING_TAIL, sources, random);
  const indexing = source === sources[0] && n >= count - INDEXING_TAIL;
  const roll = random();
  const kind = roll < 0.9 ? 'video' : roll < 0.98 ? 'image' : 'live_photo';
  let shapeRoll = random();
  const shape = SHAPES.find((candidate) => (shapeRoll -= candidate.weight) < 0) ?? SHAPES[0];
  const frameRate = kind === 'video' ? pick(random, RATES) : RATES[0];
  const seconds = kind === 'video' ? 1.5 + random() ** 2.2 * 88 : kind === 'live_photo' ? 3 : 0;
  const frames = Math.round((seconds * frameRate.num) / frameRate.den);
  // Oldest first by n; capture times spread over two years, with the odd clip missing one.
  const capturedAt = FIXTURE_NOW - Math.round((1 - age) * 730 * DAY) - Math.floor(random() * DAY);
  const addedAt = Math.max(capturedAt, FIXTURE_NOW - Math.round((1 - age) * 400 * DAY));
  const hasSpeech = kind === 'video' && random() < 0.42;
  const speech = hasSpeech ? Math.floor(random() * SPEECH.length) : null;
  const failed = !indexing && random() < 0.006;
  const missing = !indexing && !failed && random() < 0.004;
  const shotCount = kind === 'video' ? 1 + Math.floor(random() * Math.min(8, seconds / 3 + 1)) : 1;
  const total = FAKE_STAGES.length;
  const done = indexing ? Math.floor(random() * total) : failed ? 3 : total;
  // Past the searchable stages (stages.ts), search finds it.
  const searchableAt = done >= SEARCHABLE_STAGES ? addedAt + 60_000 : null;
  const reencode =
    source.kind === 'wifi_import' && kind === 'video' ? (random() < 0.12 ? 'likely' : 'unlikely') : null;
  const name = pick(random, FILE_PATTERNS)(n);
  const summary: AssetSummary = {
    id: fakeUlid<'Asset'>(KIND.asset, n),
    kind,
    name: kind === 'image' ? name.replace(/\.(MOV|mp4|MP4)$/, '.HEIC') : name,
    capturedAt: random() < 0.03 ? null : capturedAt,
    addedAt,
    duration: kind === 'image' ? null : { value: frames, rate: frameRate },
    width: shape.width,
    height: shape.height,
    orientation: shape.orientation,
    availability: missing ? 'missing' : source.status === 'offline' ? 'offline' : 'online',
    sourceIds: [source.id],
    description: done >= doneAfter('vision.describe') ? (SCENES[scene]?.description ?? null) : null,
    quality: done >= doneAfter('vision.analyse') ? Math.round((0.35 + random() * 0.63) * 100) / 100 : null,
    shotCount: done >= doneAfter('vision.shots') ? shotCount : 0,
    language: hasSpeech && done >= doneAfter('audio.transcript') ? (SPEECH[speech!]?.language ?? null) : null,
    index: { state: indexing ? 'indexing' : failed ? 'failed' : 'done', done, total, searchableAt },
    thumbnail: failed ? null : thumbnail(n, scene, shape.width / 6, shape.height / 6),
    reencode,
    trashed: false,
    provenance: { kind: 'captured' },
  };
  return { summary, extras: { n, scene, speech, frameRate } };
}

/** The whole library, oldest first, and each source's clip count. */
export function fakeLibrary(count = DEFAULT_ASSET_COUNT): { assets: FakeAsset[]; sources: FakeSource[] } {
  const sources = fakeSources();
  const assets = Array.from({ length: count }, (_, n) => fakeAsset(n, count, sources));
  const counts = new Map<Id<'Source'>, number>();
  for (const { summary } of assets) {
    const id = summary.sourceIds[0]!;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    assets,
    sources: sources.map((source) => ({
      ...source,
      assets: counts.get(source.id) ?? 0,
      missing: assets.filter(
        (a) => a.summary.availability === 'missing' && a.summary.sourceIds[0] === source.id,
      ).length,
    })),
  };
}
