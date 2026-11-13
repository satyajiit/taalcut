// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The camera-motion eval set's manifest (FRM1-MOT): every clip's file, label, split, plan and subject boxes. */
import type { CameraMotion } from '@taalcut/core';
import type { ClipPlan } from './plan';
import type { Split } from './sources';

export const MANIFEST_VERSION = 1;

export interface SubjectSampleBoxes {
  /** Seconds from the clip's start. */
  readonly t: number;
  /** Shares of the frame, top left. */
  readonly boxes: readonly { x: number; y: number; width: number; height: number }[];
}

export interface ManifestClip {
  readonly id: string;
  /** Relative to the manifest. */
  readonly file: string;
  readonly label: CameraMotion;
  readonly split: Split;
  readonly plan: ClipPlan;
  readonly subjectTrack: readonly SubjectSampleBoxes[];
}

export interface MotionManifest {
  readonly version: typeof MANIFEST_VERSION;
  readonly about: string;
  readonly sprites: readonly string[];
  readonly clips: readonly ManifestClip[];
}
