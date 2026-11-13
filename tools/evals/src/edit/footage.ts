// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's made-up footage. Nine shots of a weekend bike ride (six are in the video, three only in
 * the library), described as indexing would, with made-up words said in three of them. Nothing here is anyone's.
 */
import {
  RationalTime,
  TimeRange,
  type AssetId,
  type ShotId,
  type ShotProfile,
  type Transcript,
} from '@taalcut/core';
import { fixedId } from './ids';

export const FPS = { num: 30, den: 1 } as const;
/** Every shot's file: ten seconds at 30 fps. */
export const MEDIA_FRAMES = 300;

export interface Shot {
  readonly key: string;
  readonly assetId: AssetId;
  readonly shotId: ShotId;
  readonly fileName: string;
  readonly description: string;
  readonly tags: readonly string[];
  /** Words said in it, with their start and length in milliseconds from the file's start. */
  readonly words?: readonly (readonly [string, number, number])[];
}

const shot = (n: number, key: string, description: string, tags: readonly string[], words?: Shot['words']): Shot => ({
  key,
  assetId: fixedId<'Asset'>('01K8EA', n),
  shotId: fixedId<'Shot'>('01K8ES', n),
  fileName: `${key}.mov`,
  description,
  tags,
  ...(words ? { words } : {}),
});

/** In the video, in order. */
export const VIDEO_SHOTS = [
  shot(1, 'bike', 'A cyclist rides across an old stone bridge in the morning', ['bike', 'bridge', 'morning'], [
    ['we', 3_400, 200],
    ['rode', 3_600, 300],
    ['out', 3_900, 200],
    ['early', 4_100, 400],
  ]),
  shot(2, 'coffee', 'A hand lifts a cup of coffee at a cafe table', ['coffee', 'cafe', 'cup']),
  shot(3, 'crossing', 'A busy city crossing seen from above', ['city', 'crossing', 'street'], [
    ['the', 3_300, 150],
    ['city', 3_450, 350],
    ['was', 3_800, 200],
    ['still', 4_000, 300],
    ['asleep', 4_300, 500],
  ]),
  shot(4, 'waves', 'Waves roll onto a sandy beach', ['sea', 'beach', 'waves'], [
    ['then', 3_500, 250],
    ['the', 3_750, 150],
    ['sea', 3_900, 400],
    ['opened', 4_300, 400],
    ['up', 4_700, 300],
  ]),
  shot(5, 'dog', 'A dog runs along the beach', ['dog', 'beach', 'running']),
  shot(6, 'skyline', 'A city skyline at sunset', ['city', 'skyline', 'sunset']),
] as const;

/** Only in the library: what an insert finds. */
export const LIBRARY_SHOTS = [
  shot(7, 'harbour', 'Boats in a harbour at sunset', ['harbour', 'boats', 'sunset']),
  shot(8, 'hill', 'A cyclist climbs a steep hill', ['bike', 'hill', 'climb']),
  shot(9, 'friends', 'Friends laugh around a cafe table', ['friends', 'cafe', 'laughing']),
] as const;

export const ALL_SHOTS: readonly Shot[] = [...VIDEO_SHOTS, ...LIBRARY_SHOTS];

/** A made-up unit vector per shot (casting never runs in the eval; inserts read the profile). */
function embedding(n: number): Float32Array {
  const vector = new Float32Array(8);
  vector[n % 8] = 1;
  return vector;
}

/** What indexing said each shot shows, as the library's shotDescriptions answers timeline.get. */
export function describeShots(shotIds: readonly string[]): ReadonlyMap<string, string> {
  return new Map(ALL_SHOTS.filter((entry) => shotIds.includes(entry.shotId)).map((entry) => [entry.shotId, entry.description]));
}

export function profileOf(entry: Shot, index: number): ShotProfile {
  const at = (frames: number) => RationalTime.of(frames, FPS);
  return {
    assetId: entry.assetId,
    shotId: entry.shotId,
    kind: 'video',
    range: TimeRange.of(at(0), at(MEDIA_FRAMES)),
    available: TimeRange.of(at(0), at(MEDIA_FRAMES)),
    orientation: 'portrait',
    quality: 0.8,
    sharpness: 0.8,
    motionClass: null,
    energy: 0.5,
    faceCount: 0,
    placeClusterId: null,
    objectTags: [...entry.tags],
    description: entry.description,
    capturedAt: 1_760_000_000_000 + index * 60_000,
    fileDate: 1_760_000_000_000 + index * 60_000,
    duplicateGroup: null,
    bestTake: true,
    sourceId: null,
    embedding: embedding(index),
    motionCurve: null,
    sharpnessCurve: null,
    motionPeakFrames: [],
  };
}

/** What was said in a shot's file, for the captions. */
export function transcriptOf(assetId: AssetId): Transcript | null {
  const found = ALL_SHOTS.find((entry) => entry.assetId === assetId);
  if (!found?.words) return null;
  const ms = { num: 1000, den: 1 };
  return {
    version: 1,
    language: 'en',
    engine: 'whisper',
    model: 'eval',
    local: true,
    wordTiming: 'native',
    segments: [
      {
        text: found.words.map(([text]) => text).join(' '),
        range: { start: RationalTime.of(0, ms), duration: RationalTime.of(10_000, ms) },
        language: 'en',
        words: found.words.map(([text, start, duration]) => ({
          text,
          range: { start: RationalTime.of(start, ms), duration: RationalTime.of(duration, ms) },
        })),
      },
    ],
  };
}
