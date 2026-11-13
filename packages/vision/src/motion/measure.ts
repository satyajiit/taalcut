// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A shot's classified move as core keeps it (FRM1-MOT, core's `CameraMotionMeasure`): rates clamped to the
 * contract's range and rounded, the estimator's version kept, so a breakdown's slot and a library shot are measured
 * and stored alike.
 */
import { CAMERA_MOTION_MEASURE_MAX, type CameraMotionMeasure } from '@taalcut/core';
import type { ShotMeasure } from './classify';
import { MOTION_CONFIG } from './config';

const rounded = (value: number, digits = 5) => Number(value.toPrecision(digits));
const rate = (value: number) =>
  Math.max(-CAMERA_MOTION_MEASURE_MAX.rate, Math.min(CAMERA_MOTION_MEASURE_MAX.rate, rounded(value)));

export function cameraMeasureOf(
  shot: ShotMeasure,
  version: number = MOTION_CONFIG.version,
): CameraMotionMeasure {
  return {
    panX: rate(shot.panX),
    panY: rate(shot.panY),
    scale: rate(shot.scale),
    rotation: rate(shot.rotation),
    jitter: Math.min(CAMERA_MOTION_MEASURE_MAX.jitter, Math.max(0, rounded(shot.jitter, 4))),
    ...(shot.subjectSteady === undefined ? {} : { subjectSteady: shot.subjectSteady }),
    label: shot.label,
    confidence: Math.min(1, Math.max(0, shot.confidence)),
    version,
  };
}
