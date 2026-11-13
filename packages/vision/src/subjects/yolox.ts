// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * YOLOX's raw head (Megvii's ONNX exports, Apache-2.0, exported without decoding): [1, anchors, 5 + 80] for the
 * strides 8, 16 and 32 in turn, each a row-major grid over the square input. Per anchor: the centre offset in
 * cells, the log size in strides, the objectness and the 80 COCO class scores, both after their sigmoid. A person
 * (COCO class 0) scores objectness × class. Decoding as upstream's `demo_postprocess`. Pure.
 */
import type { Candidate } from './boxes';
import type { OnnxTensor } from '../onnx/ort';

export const YOLOX_STRIDES = [8, 16, 32] as const;
export const YOLOX_CLASSES = 80;
/** COCO's person. */
export const YOLOX_PERSON = 0;
/** The letterbox fill upstream trains with. */
export const YOLOX_PAD = 114;

export interface YoloxDecodeOptions {
  /** The square input's side. */
  readonly size: number;
  readonly scoreThreshold: number;
  readonly classId?: number;
}

export function yoloxAnchors(size: number): number {
  return YOLOX_STRIDES.reduce((sum, stride) => sum + Math.floor(size / stride) ** 2, 0);
}

export function decodeYolox(output: OnnxTensor, options: YoloxDecodeOptions): Candidate[] | string {
  const row = 5 + YOLOX_CLASSES;
  const anchors = yoloxAnchors(options.size);
  if (output.data.length !== anchors * row) return `${output.data.length / row} anchors, expected ${anchors}`;
  const data = output.data;
  const classId = options.classId ?? YOLOX_PERSON;
  const found: Candidate[] = [];
  let at = 0;
  for (const stride of YOLOX_STRIDES) {
    const cells = Math.floor(options.size / stride);
    for (let gy = 0; gy < cells; gy += 1) {
      for (let gx = 0; gx < cells; gx += 1, at += 1) {
        const base = at * row;
        const score = data[base + 4]! * data[base + 5 + classId]!;
        if (score < options.scoreThreshold) continue;
        const cx = (data[base]! + gx) * stride;
        const cy = (data[base + 1]! + gy) * stride;
        const w = Math.exp(data[base + 2]!) * stride;
        const h = Math.exp(data[base + 3]!) * stride;
        found.push({ box: { x: cx - w / 2, y: cy - h / 2, width: w, height: h }, score });
      }
    }
  }
  return found;
}
