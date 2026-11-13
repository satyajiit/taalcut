// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Small builders for the P2-L1 repository tests: one source, assets with a location, analyses, transcripts. */
import {
  RationalTime,
  TimeRange,
  unwrap,
  type AssetId,
  type MediaFacts,
  type ShotAnalysis,
  type SourceId,
  type Transcript,
} from '@taalcut/core';
import { createRepositories, type LibraryDatabase, type Repositories } from '../../src/index';
import { openTestDb } from '../helpers';

export const fps24 = { num: 24, den: 1 };
export const at24 = (frames: number) => RationalTime.of(frames, fps24);
export const range24 = (start: number, frames: number) => TimeRange.of(at24(start), at24(frames));
export const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });

let counter = 0;
const hash = (length: number) => (++counter).toString(16).padStart(length, '0').slice(-length);

export interface ProfileSetup {
  readonly db: LibraryDatabase;
  readonly repos: Repositories;
  readonly sourceId: SourceId;
  asset(options?: {
    kind?: 'video' | 'image' | 'audio';
    name?: string;
    state?: 'present' | 'missing';
  }): AssetId;
}

export function profileSetup(db: LibraryDatabase = openTestDb()): ProfileSetup {
  const repos = createRepositories(db);
  const source = unwrap(
    repos.sources.add({ kind: 'watched_folder', displayName: 'Goa trip', rootPath: '/Users/me/Goa' }),
  );
  return {
    db,
    repos,
    sourceId: source.id,
    asset(options = {}) {
      const name = options.name ?? `clip-${counter + 1}.mov`;
      const asset = unwrap(
        repos.assets.create({
          kind: options.kind ?? 'video',
          sizeBytes: 1000,
          originalFilename: name,
          contentHash: hash(64),
        }),
      );
      unwrap(
        repos.assetLocations.add({
          assetId: asset.id,
          sourceId: source.id,
          storage: 'referenced',
          relativePath: name,
          sizeBytes: 1000,
          state: options.state ?? 'present',
        }),
      );
      return asset.id;
    },
  };
}

export function analysisFor(range: TimeRange, overrides: Partial<ShotAnalysis> = {}): ShotAnalysis {
  return {
    version: 1,
    range,
    bestFrame: 2,
    orientation: 'portrait',
    quality: { version: 1, sharpness: 0.8, exposure: 0.7, stability: 0.9, overall: 0.75, flags: [] },
    motion: 'pan',
    energy: 0.4,
    onScreenText: [],
    dHash: '0123456789abcdef',
    description: {
      text: 'Golden sunset over the beach',
      objects: ['sun', 'sea'],
      place: 'beach',
      shotType: 'wide',
      model: { provider: 'test', model: 'vlm', local: true },
    },
    ...overrides,
  };
}

export function factsFor(overrides: Partial<MediaFacts> = {}): MediaFacts {
  return {
    version: 1,
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    duration: at24(240),
    frameRate: fps24,
    variableFrameRate: false,
    hdr: 'none',
    speed: 'normal',
    speedFactor: 1,
    retimedInFile: false,
    hasAudio: true,
    captureTime: '2025-10-20T19:30:00+05:30',
    ...overrides,
  };
}

/** One segment per entry: [text, start ms, length ms]; each word an equal share. */
export function transcriptOf(language: string, segments: [string, number, number][]): Transcript {
  return {
    version: 1,
    language,
    engine: 'parakeet',
    model: 'test-asr',
    local: true,
    wordTiming: 'native',
    segments: segments.map(([text, start, length]) => {
      const words = text.split(' ');
      const step = Math.floor(length / words.length);
      return {
        text,
        range: TimeRange.of(ms(start), ms(length)),
        language,
        words: words.map((word, i) => ({ text: word, range: TimeRange.of(ms(start + i * step), ms(step)) })),
      };
    }),
  };
}
