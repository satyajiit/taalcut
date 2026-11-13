// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Subject samples and tracks for the reframe tests, in core's top-left boxes. */
import {
  FrameRate,
  newId,
  RationalTime,
  TimeRange,
  type AssetId,
  type SubjectSample,
  type SubjectTrack,
} from '@taalcut/core';
import { TRACK_RECIPE } from '../../src/reframe/subject-tracker';
import type { SourceRect } from '../../src/reframe/framing-types';

export const RATE_30 = FrameRate.of(30);

export interface SampleBoxes {
  readonly face?: SourceRect;
  readonly human?: SourceRect;
  readonly saliency?: SourceRect;
  readonly confidence?: number;
  readonly source?: 'detect' | 'track';
  /** For tracker samples: the tracked box. */
  readonly tracked?: SourceRect;
}

/** One sample at `seconds` of source time (asset rate 30 fps). */
export function sampleAt(seconds: number, boxes: SampleBoxes = {}): SubjectSample {
  const confidence = boxes.confidence ?? 0.9;
  const source = boxes.source ?? 'detect';
  const subjectBox = boxes.tracked ?? boxes.human ?? boxes.face ?? boxes.saliency ?? null;
  return {
    t: RationalTime.fromSeconds(seconds, RATE_30),
    source,
    faces:
      source === 'detect' && boxes.face ? [{ box: boxes.face, confidence, roll: 0, yaw: 0, pitch: 0 }] : [],
    humans: source === 'detect' && boxes.human ? [{ box: boxes.human, confidence }] : [],
    saliency: source === 'detect' && boxes.saliency ? [{ box: boxes.saliency, confidence }] : [],
    subject: {
      kind: subjectBox
        ? source === 'track'
          ? 'track'
          : boxes.face
            ? 'face'
            : boxes.human
              ? 'human'
              : 'saliency'
        : 'none',
      box: subjectBox,
      focus: subjectBox
        ? { x: subjectBox.x + subjectBox.width / 2, y: subjectBox.y + subjectBox.height / 2 }
        : null,
      confidence: subjectBox ? confidence : 0,
    },
  };
}

/** A track over [0, seconds) of a 30 fps asset. */
export function trackOf(samples: readonly SubjectSample[], seconds: number, assetId?: AssetId): SubjectTrack {
  return {
    version: 1,
    assetId: assetId ?? newId<'Asset'>(),
    contentHash: 'a'.repeat(64),
    range: TimeRange.of(RationalTime.zero(RATE_30), RationalTime.fromSeconds(seconds, RATE_30)),
    recipe: TRACK_RECIPE,
    compute: { faces: 'neuralEngine' },
    samples: [...samples],
  };
}

/** Samples every 1/hz seconds over [0, seconds), boxes from `at`. */
export function samplesEvery(hz: number, seconds: number, at: (t: number) => SampleBoxes): SubjectSample[] {
  const count = Math.floor(seconds * hz);
  return Array.from({ length: count }, (_, index) => sampleAt(index / hz, at(index / hz)));
}

/** A deterministic ±amplitude noise source (mulberry32). */
export function noise(seed: number, amplitude: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const unit = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    return (unit * 2 - 1) * amplitude;
  };
}
