// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the no-helper subject detector finds in a frame (FRM1-SUB): faces, people and poses, as fractions of the
 * frame, origin top left. Apart from detector.ts so heads.ts can read them without an import cycle.
 */
import type { FractionBox } from './boxes';

export interface DetectedFace {
  readonly box: FractionBox;
  readonly confidence: number;
  /** Radians, Vision's sign (the helper's): positive when the face turns towards the frame's right. */
  readonly yaw?: number;
}

/** A keypoint as fractions of the frame, with the model's score for it. */
export interface PoseKeypoint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

export interface DetectedPose {
  readonly box: FractionBox;
  readonly confidence: number;
  /** COCO's 17 keypoints in COCO's order (rtmo.ts `COCO_KEYPOINTS`). */
  readonly keypoints: readonly PoseKeypoint[];
}

export interface DetectedPerson {
  readonly box: FractionBox;
  readonly confidence: number;
}

export interface FrameSubjects {
  readonly faces: readonly DetectedFace[];
  readonly people: readonly DetectedPerson[];
  /** Absent from a detector without a pose model. */
  readonly poses?: readonly DetectedPose[];
}
