// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: the edit eval's subject tracks, made up. In the coffee shot someone sits facing the camera for its first
 * six seconds, then turns away; no other shot has anyone in it. Detect samples at 4 Hz, as the tracker writes them,
 * for any range asked: every range counts as tracked, so a slip away from a face has something to go by.
 */
import { ok, RationalTime, type SubjectSample, type SubjectSource } from '@taalcut/core';
import { shotByKey } from './check';
import { FPS } from './footage';

const HZ = 4;
const FACING_UNTIL_SECONDS = 6;
const PERSON = { x: 0.35, y: 0.3, width: 0.3, height: 0.5 } as const;

function sample(seconds: number, seen: boolean): SubjectSample {
  const facing = seen && seconds < FACING_UNTIL_SECONDS;
  const face = { x: PERSON.x + 0.09, y: PERSON.y, width: 0.12, height: 0.12 };
  return {
    t: RationalTime.fromSeconds(seconds, FPS, 'round'),
    source: 'detect',
    faces: facing ? [{ box: face, confidence: 0.9, roll: 0, yaw: 0, pitch: 0 }] : [],
    humans: seen ? [{ box: PERSON, confidence: 0.9 }] : [],
    saliency: [],
    heads: [],
    people: seen ? [{ box: PERSON, confidence: 0.9 }] : [],
    subject: { kind: seen ? 'human' : 'none', box: seen ? PERSON : null, focus: null, confidence: 0.9 },
  };
}

export function subjectsStandIn(): SubjectSource {
  const coffee = shotByKey('coffee').assetId as string;
  return {
    async over(range) {
      const from = RationalTime.toSeconds(range.start);
      const to = RationalTime.toSeconds(range.end);
      const samples: SubjectSample[] = [];
      for (let k = Math.ceil(from * HZ); k / HZ < to; k++)
        samples.push(sample(k / HZ, range.assetId === coffee));
      return ok({ frame: { width: 1080, height: 1920 }, detector: 'vision', samples });
    },
    async ensure() {
      return ok(undefined);
    },
  };
}
