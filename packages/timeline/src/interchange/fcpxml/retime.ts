// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's speed as an FCPXML `<timeMap>` (P3-V5): `time` is the clip's local (retimed) time, starting at its
 * `start` (the in-point), and `value` the source time it plays. A held ramp is exact with linear points at each
 * ramp point; linear and eased ramps are sampled every few frames with linear points, so Final Cut follows the
 * curve to within a fraction of a frame (`rampApproximated` until the manual check confirms it plays the same).
 */
import type { Clip } from '@taalcut/core';
import { sourceFrames } from '../../model/speed';
import { add, framesToSeconds, type Seconds } from '../seconds';
import { approxFramesToSeconds, fcpTime } from './time';
import { element, type XmlNode } from './xml';

/** Canvas frames between samples of a curved ramp. */
export const RETIME_SAMPLE_FRAMES = 4;

/** The canvas frames into the clip where a point is written. */
function sampleFrames(clip: Clip): number[] {
  const speed = clip.speed;
  const length = clip.duration.value;
  if (!speed) return [0, length];
  const frames = new Set<number>([0, length]);
  for (const point of speed.points) {
    const at = point.at.value - (speed.windowStart?.value ?? 0);
    if (at > 0 && at < length) frames.add(at);
  }
  if (speed.curve !== 'hold')
    for (let frame = RETIME_SAMPLE_FRAMES; frame < length; frame += RETIME_SAMPLE_FRAMES) frames.add(frame);
  return [...frames].sort((a, b) => a - b);
}

/** Null for a clip that plays in real time. */
export function timeMap(clip: Clip, start: Seconds): XmlNode | null {
  if (!clip.speed && !clip.holdFrame) return null;
  const canvas = clip.duration.rate;
  const points = sampleFrames(clip).map((frame) =>
    element('timept', {
      time: fcpTime(add(start, framesToSeconds(frame, canvas))),
      value: fcpTime(
        add(start, approxFramesToSeconds(clip.holdFrame ? 0 : sourceFrames(clip.speed, frame), canvas)),
      ),
      interp: 'linear',
    }),
  );
  return element('timeMap', {}, points);
}
