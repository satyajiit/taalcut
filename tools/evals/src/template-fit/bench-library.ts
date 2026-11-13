// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fit bench's world (LRN1-TPL): a library of portrait video shots written through the library's repositories
 * (facts, shot analyses, one import source) with eight frame vectors each in a 768-dimension sqlite-vec index, as
 * vision writes them, and templates of eight one-second slots, their vectors written by the template index's writer.
 * Shots and slot intents are drawn from the same themes, so casting finds candidates as it would in a real library.
 * Deterministic: the same seed gives the same library.
 */
import { createHash } from 'node:crypto';
import {
  CAMERA_MOTIONS,
  ok,
  RationalTime,
  SHOT_TYPES,
  TimeRange,
  unwrap,
  type Embedder,
  type MediaFacts,
  type ShotAnalysis,
  type SourceId,
  type VectorIndex,
  type VectorItem,
} from '@taalcut/core';
import { createRepositories, openVectorIndex, type LibraryDatabase } from '@taalcut/library';
import { fixtureTemplate } from '../casting/template';
import type { WorldTemplate } from './world';

export const BENCH_DIMS = 768;
const FRAMES_PER_SHOT = 8;
const RATE = { num: 30, den: 1 };
const THEMES = [
  'beach waves sand',
  'market stalls crowd',
  'kitchen coffee pouring',
  'gym weights training',
  'city night lights',
  'forest trail hiking',
  'desk laptop typing',
  'street food frying',
  'temple bells prayer',
  'train window landscape',
  'wedding dance stage',
  'skate park tricks',
  'rain window drops',
  'garden flowers bloom',
  'mountain summit view',
  'cafe friends laughing',
  'studio guitar playing',
  'car road trip',
  'pool swimming splash',
  'bookshop shelves reading',
] as const;

const hex = (seed: string, length: number) =>
  createHash('sha256').update(seed).digest('hex').slice(0, length);

/** A deterministic unit vector per word, summed and normalised: texts sharing words are close. */
export function benchVector(text: string, jitter = 0, seed = 0): Float32Array {
  const vector = new Float32Array(BENCH_DIMS);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    const digest = createHash('sha256').update(word).digest();
    for (let i = 0; i < BENCH_DIMS; i += 1) {
      const byte = digest[(i * 7) % digest.length] ?? 0;
      vector[i] = (vector[i] ?? 0) + (((byte ^ (i * 131)) & 0xff) / 127.5 - 1);
    }
  }
  if (jitter > 0) {
    const noise = createHash('sha256').update(`noise:${seed}`).digest();
    for (let i = 0; i < BENCH_DIMS; i += 1)
      vector[i] = (vector[i] ?? 0) + jitter * ((noise[i % 32] ?? 0) / 127.5 - 1);
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

/** The bench's embedder: benchVector in a space of its own. */
export function benchEmbedder(): Embedder {
  return {
    space: { model: 'bench-words', revision: '1', dimensions: BENCH_DIMS, indexName: 'bench_words_1' },
    embedTexts: async (texts) => ok(texts.map((text) => benchVector(text))),
  };
}

function facts(duration: RationalTime): MediaFacts {
  return {
    version: 1,
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    duration,
    frameRate: RATE,
    variableFrameRate: false,
    hdr: 'none',
    speed: 'normal',
    speedFactor: 1,
    retimedInFile: false,
    hasAudio: true,
    captureTime: '2026-09-01T10:00:00+05:30',
    device: { make: 'Apple', model: 'iPhone 17 Pro' },
  };
}

function analysis(theme: string, shot: number, range: TimeRange): ShotAnalysis {
  const quality = 0.55 + (shot % 5) / 12;
  return {
    version: 1,
    range,
    bestFrame: 0,
    orientation: 'portrait',
    quality: { version: 1, sharpness: quality, exposure: 0.8, stability: 0.7, overall: quality, flags: [] },
    motion: CAMERA_MOTIONS[shot % CAMERA_MOTIONS.length] ?? 'static',
    energy: (shot % 10) / 10,
    onScreenText: [],
    dHash: hex(`dhash:${shot}`, 16),
    description: {
      text: `${SHOT_TYPES[shot % 4] ?? 'wide'} shot of ${theme}`,
      objects: theme.split(' '),
      place: theme.split(' ')[0] ?? 'somewhere',
      shotType: SHOT_TYPES[shot % 4] ?? 'wide',
      model: { provider: 'bench', model: 'bench-vlm', local: true },
    },
  };
}

/** `shots` shots (two per asset, two seconds each) in one import source, with their frame vectors. */
export function seedBenchShots(
  db: LibraryDatabase,
  shots: number,
  indexName: string,
): { source: SourceId; index: VectorIndex } {
  const index = unwrap(openVectorIndex(db, { name: indexName, dimensions: BENCH_DIMS }));
  const source = db.transaction(() => {
    const repos = createRepositories(db);
    const sourceId = unwrap(
      repos.sources.add({ kind: 'watched_folder', displayName: 'Bench', rootPath: '/bench' }),
    ).id;
    const vectors: VectorItem[] = [];
    const length = RationalTime.of(60, RATE);
    for (let asset = 0; asset < Math.ceil(shots / 2); asset += 1) {
      const created = unwrap(
        repos.assets.create({
          kind: 'video',
          sizeBytes: 1_000_000 + asset,
          originalFilename: `bench-${asset}.mov`,
          contentHash: hex(`content:${asset}`, 64),
          partialHash: hex(`partial:${asset}`, 32),
        }),
      );
      unwrap(
        repos.assetLocations.add({
          assetId: created.id,
          sourceId,
          storage: 'referenced',
          relativePath: `bench-${asset}.mov`,
          sizeBytes: created.sizeBytes,
          state: 'present',
        }),
      );
      unwrap(repos.assets.setFacts(created.id, facts(RationalTime.of(120, RATE))));
      const ranges = [0, 1].map((n) => TimeRange.of(RationalTime.of(n * 60, RATE), length));
      const shotIds = unwrap(repos.shots.replaceForAsset(created.id, 0, ranges));
      shotIds.forEach((shotId, n) => {
        const number = asset * 2 + n;
        const theme = THEMES[number % THEMES.length] ?? THEMES[0];
        const range = ranges[n] ?? TimeRange.of(RationalTime.of(0, RATE), length);
        unwrap(repos.shots.putAnalyses([{ shotId, analysis: analysis(theme, number, range) }]));
        for (let frame = 0; frame < FRAMES_PER_SHOT; frame += 1)
          vectors.push({
            id: `frame:${shotId}:${frame}`,
            vector: benchVector(theme, 0.4, number * FRAMES_PER_SHOT + frame),
            metadata: { assetId: created.id, sourceId, kind: 'frame' },
          });
      });
    }
    unwrap(index.upsert(vectors));
    return sourceId;
  });
  return { source, index };
}

/** `count` templates of eight one-second slots, their intents drawn from the themes. */
export function benchTemplates(count: number): WorldTemplate[] {
  return Array.from({ length: count }, (_, number) => {
    const slots = Array.from({ length: 8 }, (_, slot) => {
      const theme = THEMES[(number * 3 + slot) % THEMES.length] ?? THEMES[0];
      return {
        frames: 30,
        intent: `${SHOT_TYPES[slot % 4] ?? 'wide'} shot of ${theme}`,
        motion: CAMERA_MOTIONS[slot % CAMERA_MOTIONS.length] ?? 'static',
        energy: (slot % 5) / 5,
      };
    });
    return { key: `bench-${number}`, template: fixtureTemplate(slots), name: `Bench template ${number}` };
  });
}
