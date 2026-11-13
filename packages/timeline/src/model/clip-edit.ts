// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Changing a clip's length at one edge while the content stays where it was
 * on the timeline: trimming the start moves the in-point with it, trimming the
 * end changes nothing else. Gaps just change length. Ramps keep their shape
 * relative to the content.
 */
import { RationalTime, type Clip, type FrameRate, type SpeedRamp } from '@taalcut/core';
import type { Filler } from './sequence';
import { mediaRate, sourceFrames, trimRamp } from './speed';

/** `canvasFrames` of timeline time as media time at `rate`, to the nearest media frame. */
export function toMedia(canvasFrames: number, canvasRate: FrameRate, rate: FrameRate): RationalTime {
  return RationalTime.rescale(RationalTime.of(canvasFrames, canvasRate), rate, 'round');
}

/** Keep the original curve and move its window, including cuts inside an ease segment. */
function shiftRamp(ramp: SpeedRamp, by: number): SpeedRamp {
  const rate = ramp.points[0]?.at.rate as FrameRate;
  return { ...ramp, windowStart: RationalTime.of((ramp.windowStart?.value ?? 0) - by, rate) };
}

/**
 * Removes `delta` frames from the start of the item (negative adds frames): duration shrinks by delta and a
 * clip's in-point moves later by the media those frames showed.
 */
export function trimStart<T extends Filler>(item: T, delta: number, canvasRate: FrameRate): T {
  const duration = RationalTime.of(item.duration.value - delta, canvasRate);
  if (item.type === 'gap') return { ...item, duration };
  if (item.type === 'program') return { ...item, duration, sourceStart: RationalTime.add(item.sourceStart, RationalTime.of(delta, canvasRate)) };
  const clip = item as Clip;
  const rate = mediaRate(clip.media);
  if (!rate || clip.holdFrame) return clampClipFades({ ...clip, duration }) as T;
  let shift: RationalTime;
  let speed = clip.speed;
  if (!speed) shift = toMedia(delta, canvasRate, rate);
  else {
    shift = RationalTime.of(
      Math.round((sourceFrames(speed, delta) * canvasRate.den * rate.num) / (canvasRate.num * rate.den)),
      rate,
    );
    speed = trimRamp(shiftRamp(speed, -delta), duration.value);
  }
  return clampClipFades({
    ...clip,
    duration,
    speed,
    sourceStart: RationalTime.add(clip.sourceStart, shift),
  }) as T;
}

/** Adds `delta` frames at the end of the item (negative removes them). */
export function trimEnd<T extends Filler>(item: T, delta: number, canvasRate: FrameRate): T {
  const duration = RationalTime.of(item.duration.value + delta, canvasRate);
  if (item.type === 'gap' || item.type === 'program') return { ...item, duration };
  const clip = item as Clip;
  const speed = clip.speed && delta < 0 ? trimRamp(clip.speed, duration.value) : clip.speed;
  return clampClipFades({ ...clip, duration, speed }) as T;
}

/** Fades cannot extend past a shortened clip, including one-frame freeze boundaries. */
function clampClipFades(clip: Clip): Clip {
  const fade = (time: RationalTime) => RationalTime.min(time, clip.duration);
  return {
    ...clip,
    audio: {
      ...clip.audio,
      ...(clip.audio.fadeIn ? { fadeIn: fade(clip.audio.fadeIn) } : {}),
      ...(clip.audio.fadeOut ? { fadeOut: fade(clip.audio.fadeOut) } : {}),
    },
  };
}
