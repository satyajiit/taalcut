// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: made-up subject tracks. A person is a box over time (or nobody), a face is on or off; samples are detect
 * samples at 4 Hz in asset time at 30 fps, as FRM1-SUB's tracker writes them.
 */
import {
  FrameRates,
  ok,
  RationalTime,
  type ShotProfile,
  type SubjectClipRange,
  type SubjectSample,
  type SubjectSource,
  type SubjectSpan,
} from '@taalcut/core';
import { makeProfile, unitVector } from './library';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What is in frame at a moment (seconds from the asset's start). */
export type Scene = (t: number) => { readonly person?: Box; readonly face?: boolean };

export const DETECT_HZ = 4;
/** Landscape 16:9, as a phone held sideways. */
export const FRAME = { width: 1920, height: 1080 } as const;

function sample(t: number, scene: Scene): SubjectSample {
  const { person, face } = scene(t);
  const faceBox = person
    ? {
        x: person.x + person.width * 0.3,
        y: person.y,
        width: person.width * 0.4,
        height: person.height * 0.25,
      }
    : null;
  return {
    t: RationalTime.fromSeconds(t, FrameRates.fps30, 'round'),
    source: 'detect',
    faces: face && faceBox ? [{ box: faceBox, confidence: 0.9, roll: 0, yaw: 0, pitch: 0 }] : [],
    humans: person ? [{ box: person, confidence: 0.9 }] : [],
    saliency: [],
    heads: [],
    people: person ? [{ box: person, confidence: 0.9 }] : [],
    subject: { kind: person ? 'human' : 'none', box: person ?? null, focus: null, confidence: 0.9 },
  };
}

/** The detect samples of a scene over [from, to) seconds. */
export function spanOf(scene: Scene, from: number, to: number): SubjectSpan {
  const samples: SubjectSample[] = [];
  for (let k = Math.ceil(from * DETECT_HZ); k / DETECT_HZ < to; k++)
    samples.push(sample(k / DETECT_HZ, scene));
  return { frame: FRAME, detector: 'vision', samples };
}

/** Stands at x 0.4 (a little detector jitter) until `walkFrom` seconds, then walks right at 0.1 frame widths a second. */
export const standsThenWalks =
  (walkFrom: number): Scene =>
  (t) => ({
    person: {
      x: 0.4 + (t < walkFrom ? 0.003 * Math.sin(t * 7) : 0.1 * (t - walkFrom)),
      y: 0.4,
      width: 0.15,
      height: 0.4,
    },
  });

/** A shot `seconds` long at 30 fps from the asset's start: flat sharpness, the frame's motion flat (a push-in through a crowd). */
export function pushInShot(seconds: number, extra: Partial<ShotProfile> = {}): ShotProfile {
  const frames = Math.round(seconds * 30);
  const base = makeProfile({ embedding: unitVector(11), frames, peaks: [], orientation: 'landscape' });
  return {
    ...base,
    motionCurve: base.motionCurve!.map(() => 0.2),
    sharpnessCurve: base.sharpnessCurve!.map(() => 0.5),
    ...extra,
  };
}

/** A SubjectSource over scenes by asset: `over` answers what `tracked` holds, `ensure` tracks what it is asked. */
export function fakeSubjects(
  scenes: ReadonlyMap<string, Scene>,
  options: { readonly tracks?: boolean } = {},
) {
  const asked: SubjectClipRange[] = [];
  const tracked: SubjectClipRange[] = [];
  const covers = (outer: SubjectClipRange, inner: SubjectClipRange) =>
    outer.assetId === inner.assetId &&
    RationalTime.toSeconds(outer.start) <= RationalTime.toSeconds(inner.start) + 1e-6 &&
    RationalTime.toSeconds(outer.end) >= RationalTime.toSeconds(inner.end) - 1e-6;
  const source: SubjectSource = {
    async over(range) {
      const scene = scenes.get(range.assetId);
      if (!scene || !tracked.some((made) => covers(made, range))) return ok(undefined);
      return ok(spanOf(scene, RationalTime.toSeconds(range.start), RationalTime.toSeconds(range.end)));
    },
    async ensure(ranges) {
      asked.push(...ranges);
      if (options.tracks !== false) tracked.push(...ranges);
      return ok(undefined);
    },
  };
  return { source, asked, tracked };
}
