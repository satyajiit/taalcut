// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * RTMO-s (MMPose, Apache-2.0, trained on COCO person keypoints only) as mmdeploy exports it end to end: `dets`
 * [1, N, 5] (x0, y0, x1, y1, score in tensor pixels) and `keypoints` [1, N, 17, 3] (x, y, score), the 17 COCO
 * keypoints in COCO's order. The input is the frame letterboxed into 640 × 640 at the top left, BGR 0–255, filled
 * with 114 (no mean or scale). Pure.
 */
import type { Candidate } from './boxes';
import type { OnnxTensor } from '../onnx/ort';

export const RTMO_SIZE = 640;
export const RTMO_PAD = 114;
export const RTMO_OUTPUTS = ['dets', 'keypoints'] as const;
/** COCO's keypoints, in order. */
export const COCO_KEYPOINTS = [
  'nose',
  'leftEye',
  'rightEye',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const;
export type CocoKeypoint = (typeof COCO_KEYPOINTS)[number];

export interface PixelKeypoint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

export interface PoseCandidate extends Candidate {
  /** The 17 COCO keypoints in tensor pixels. */
  readonly keypoints: readonly PixelKeypoint[];
}

export function decodeRtmo(
  outputs: Readonly<Record<string, OnnxTensor>>,
  options: { readonly scoreThreshold: number },
): PoseCandidate[] | string {
  const dets = outputs.dets;
  const keypoints = outputs.keypoints;
  if (!dets || !keypoints) return 'no dets or keypoints';
  const people = dets.dims[1] ?? 0;
  if (dets.data.length !== people * 5) return `dets holds ${dets.data.length} values for ${people} people`;
  const per = COCO_KEYPOINTS.length * 3;
  if (keypoints.data.length !== people * per)
    return `keypoints holds ${keypoints.data.length} values for ${people} people`;
  const found: PoseCandidate[] = [];
  for (let n = 0; n < people; n += 1) {
    const score = dets.data[n * 5 + 4]!;
    if (!(score >= options.scoreThreshold)) continue;
    const x0 = dets.data[n * 5]!;
    const y0 = dets.data[n * 5 + 1]!;
    const x1 = dets.data[n * 5 + 2]!;
    const y1 = dets.data[n * 5 + 3]!;
    if (!(x1 > x0 && y1 > y0)) continue;
    const points: PixelKeypoint[] = [];
    for (let k = 0; k < COCO_KEYPOINTS.length; k += 1) {
      const at = n * per + k * 3;
      points.push({ x: keypoints.data[at]!, y: keypoints.data[at + 1]!, score: keypoints.data[at + 2]! });
    }
    found.push({ box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, score, keypoints: points });
  }
  return found;
}
