// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's made-up library. Eight ten-second portrait shots of a made-up day, described as indexing
 * would, each with its measured camera move and, where someone is in it, a made-up subject track: where the person
 * stands and when their face shows. Vectors are bags of the words a shot's description and objects use (and a need's
 * words, through `wordsEmbedder`), so "closer by meaning" is closer by shared words. Nothing here is anyone's.
 */
import {
  ok,
  RationalTime,
  TimeRange,
  type AssetId,
  type CameraMotion,
  type Embedder,
  type ShotId,
  type ShotProfile,
  type SubjectSample,
  type SubjectSource,
} from '@taalcut/core';
import { fixedId } from '../edit/ids';

export const FPS = { num: 30, den: 1 } as const;
/** Every shot's file: ten seconds at 30 fps. */
export const MEDIA_FRAMES = 300;
const DIMS = 64;
const HZ = 4;

export interface MakeShot {
  readonly key: string;
  readonly assetId: AssetId;
  readonly shotId: ShotId;
  readonly description: string;
  readonly tags: readonly string[];
  readonly motion: CameraMotion;
  /** The person in it: their head (shares of the frame) and the seconds their face shows, [from, to). */
  readonly person?: {
    readonly head: { x: number; y: number; width: number; height: number };
    readonly face: readonly [number, number];
  };
}

const shot = (
  n: number,
  key: string,
  description: string,
  tags: readonly string[],
  motion: CameraMotion,
  person?: MakeShot['person'],
): MakeShot => ({
  key,
  assetId: fixedId<'Asset'>('01K9MA', n),
  shotId: fixedId<'Shot'>('01K9MS', n),
  description,
  tags,
  motion,
  ...(person ? { person } : {}),
});

const LEFT = { x: 0.18, y: 0.24, width: 0.2, height: 0.12 };
const MIDDLE = { x: 0.4, y: 0.2, width: 0.2, height: 0.12 };
const RIGHT = { x: 0.62, y: 0.22, width: 0.2, height: 0.12 };

export const MAKE_SHOTS: readonly MakeShot[] = [
  shot(1, 'street', 'A man walks along a busy street past shop windows', ['street', 'shops'], 'tracking', {
    head: RIGHT,
    face: [0, 10],
  }),
  // Facing the lens for its first four seconds, then turned to the screen: a window with the face kept out exists.
  shot(
    2,
    'phone',
    'Someone on a sofa looks at a phone and scrolls through messages',
    ['phone', 'sofa'],
    'static',
    { head: LEFT, face: [0, 4] },
  ),
  shot(
    3,
    'coffee',
    'A cup of coffee steams on a wooden table by a window',
    ['cup', 'coffee', 'table'],
    'static',
  ),
  shot(4, 'beach', 'Waves roll onto an empty beach at dusk', ['beach', 'waves'], 'pan'),
  shot(5, 'laugh', 'A woman laughs at the camera in a sunny park', ['park', 'grass'], 'handheld', {
    head: MIDDLE,
    face: [0, 10],
  }),
  shot(6, 'bus', 'A city bus drives past a stop in the rain', ['bus', 'rain'], 'pan'),
  shot(7, 'keys', 'Hands pick up keys from a bowl by the door', ['keys', 'bowl', 'door'], 'static'),
  shot(8, 'run', 'A runner jogs along a river path in the morning', ['river', 'path'], 'tracking', {
    head: MIDDLE,
    face: [0, 10],
  }),
];

export function shotByKey(key: string): MakeShot {
  const found = MAKE_SHOTS.find((entry) => entry.key === key);
  if (!found) throw new Error(`No made-up shot ${key}`);
  return found;
}

/** A bag of words, hashed into DIMS and made a unit vector: shared words make a high cosine. */
function bag(text: string): Float32Array {
  const out = new Float32Array(DIMS);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (word.length < 3) continue;
    const stem = word.replace(/(ing|es|s)$/, '');
    let hash = 7;
    for (const char of stem) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    out[hash % DIMS]! += 1;
  }
  const norm = Math.hypot(...out);
  return norm === 0 ? out : out.map((value) => value / norm);
}

export const wordsEmbedder: Embedder = {
  space: { model: 'eval-words', revision: 'bag', dimensions: DIMS, indexName: 'eval_words' },
  embedTexts: async (texts) => ok(texts.map(bag)),
};

export function profileOf(entry: MakeShot, index: number): ShotProfile {
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
    motionClass: entry.motion,
    energy: 0.5,
    faceCount: entry.person ? 1 : 0,
    placeClusterId: null,
    objectTags: [...entry.tags],
    description: entry.description,
    capturedAt: 1_760_000_000_000 + index * 60_000,
    fileDate: 1_760_000_000_000 + index * 60_000,
    duplicateGroup: null,
    bestTake: true,
    sourceId: null,
    embedding: bag(`${entry.description} ${entry.tags.join(' ')}`),
    motionCurve: null,
    sharpnessCurve: null,
    motionPeakFrames: [],
  };
}

export const MAKE_PROFILES: readonly ShotProfile[] = MAKE_SHOTS.map(profileOf);

export function describeShots(shotIds: readonly string[]): ReadonlyMap<string, string> {
  return new Map(
    MAKE_SHOTS.filter((entry) => shotIds.includes(entry.shotId)).map((entry) => [
      entry.shotId,
      entry.description,
    ]),
  );
}

function sample(entry: MakeShot | undefined, seconds: number): SubjectSample {
  const person = entry?.person;
  const facing = !!person && seconds >= person.face[0] && seconds < person.face[1];
  const body = person
    ? { x: person.head.x - 0.05, y: person.head.y, width: person.head.width + 0.1, height: 0.6 }
    : null;
  return {
    t: RationalTime.fromSeconds(seconds, FPS, 'round'),
    source: 'detect',
    faces: facing
      ? [
          {
            box: { ...person.head, x: person.head.x + 0.04, width: 0.12 },
            confidence: 0.9,
            roll: 0,
            yaw: 0,
            pitch: 0,
          },
        ]
      : [],
    humans: body ? [{ box: body, confidence: 0.9 }] : [],
    saliency: [],
    heads: person ? [{ box: person.head, confidence: 0.9 }] : [],
    people: body ? [{ box: body, confidence: 0.9 }] : [],
    subject: { kind: person ? 'human' : 'none', box: body, focus: null, confidence: 0.9 },
  };
}

/** The made-up tracks at 4 Hz for any range asked: every range counts as tracked. */
export function makeSubjects(): SubjectSource {
  return {
    async over(range) {
      const entry = MAKE_SHOTS.find((candidate) => candidate.assetId === range.assetId);
      const from = RationalTime.toSeconds(range.start);
      const to = RationalTime.toSeconds(range.end);
      const samples: SubjectSample[] = [];
      for (let k = Math.ceil(from * HZ); k / HZ < to; k++) samples.push(sample(entry, k / HZ));
      return ok({ frame: { width: 1080, height: 1920 }, detector: 'vision', samples });
    },
    async ensure() {
      return ok(undefined);
    },
  };
}
