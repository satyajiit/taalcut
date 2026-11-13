// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.setSpeed (EDT1-OPS, SPEC "EDT1-OPS: speed"): a video clip's speed, constant, a ramp over shares of the
 * clip, or back to normal (`speed: null`). With `fit: 'media'` the clip keeps what it shows, so its length becomes
 * that media over the new speed and what follows ripples (insert-extras.ts or ripple.ts) with every later cut
 * re-synced to the grid; with `fit: 'length'` it keeps its place and shows more or less of its media
 * (`timeline.media_too_short` when the media runs out). Either way the clip takes the anchor of its start again,
 * its peak on the beat where the media allows. The sound follows SPEED_AUDIO's policy (core).
 */
import {
  err,
  ok,
  RationalTime,
  SPEED_KEEPS_PITCH,
  type Clip,
  type FrameRate,
  type Result,
  type SpeedChange,
  type SpeedRamp,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { InvalidMove, MediaTooShort } from '../errors';
import { positions, videoItems, withVideoItems } from '../model/sequence';
import { clipMediaFits, rampFrames, sourceFrames } from '../model/speed';
import { resync } from '../resync/resync';
import { insertExtras } from './insert-extras';
import { rippleExtras } from './ripple';
import { timeMap } from './time-map';
import { clipPosition, type EditOptions, type EditResult } from './types';

export interface SpeedInput {
  readonly clipId: TimelineItemId;
  readonly speed: SpeedChange;
  readonly fit: 'media' | 'length';
  readonly audio?: 'keepPitch' | 'mute' | undefined;
}

/** The change as a ramp over `frames` canvas frames; null is real time. */
export function rampOver(change: SpeedChange, frames: number, rate: FrameRate): SpeedRamp | null {
  if (change.kind === 'normal' || (change.kind === 'constant' && change.speed === 1)) return null;
  if (change.kind === 'constant')
    return {
      curve: 'hold',
      points: [
        { at: RationalTime.of(0, rate), speed: change.speed },
        { at: RationalTime.of(frames, rate), speed: change.speed },
      ],
    };
  const points: SpeedRamp['points'][number][] = [];
  for (const point of change.points) {
    const at = Math.min(frames, Math.round(point.at * frames));
    if (points.length > 0 && at <= (points.at(-1)?.at.value ?? -1)) continue;
    points.push({ at: RationalTime.of(at, rate), speed: point.speed });
  }
  if (points.length < 2) points.push({ at: RationalTime.of(frames, rate), speed: points[0]?.speed ?? 1 });
  return { curve: change.curve, points };
}

/** Source canvas frames per timeline frame over the whole change: what `fit: 'media'` divides by. */
function meanOf(change: SpeedChange, rate: FrameRate): number {
  const nominal = 1_000_000;
  const ramp = rampOver(change, nominal, rate);
  return ramp ? rampFrames(ramp, nominal) / nominal : 1;
}

/** Every speed the change plays at. */
const speedsOf = (change: SpeedChange): number[] =>
  change.kind === 'normal' ? [1] : change.kind === 'constant' ? [change.speed] : change.points.map((p) => p.speed);

/** The sound's policy: muted when asked, or unasked when a speed is outside the range that keeps pitch well. */
function withSound(clip: Clip, input: SpeedInput): Clip {
  const far = speedsOf(input.speed).some((s) => s < SPEED_KEEPS_PITCH.min || s > SPEED_KEEPS_PITCH.max);
  const mute = input.audio === 'mute' || (input.audio === undefined && far);
  return mute ? { ...clip, audio: { ...clip.audio, muted: true } } : clip;
}

/** The new clip for `fit: 'media'`: as long as its media lasts at the new speed, a frame shorter while it overruns. */
function mediaFitted(clip: Clip, change: SpeedChange, rate: FrameRate): Clip | null {
  const media = sourceFrames(clip.speed, clip.duration.value);
  let frames = Math.max(1, Math.round(media / meanOf(change, rate)));
  for (let tries = 0; tries < 8 && frames >= 1; tries++, frames--) {
    const next: Clip = { ...clip, duration: RationalTime.of(frames, rate), speed: rampOver(change, frames, rate) };
    if (clipMediaFits(next, rate)) return next;
  }
  return null;
}

export function setSpeed(
  timeline: Timeline,
  input: SpeedInput,
  options: EditOptions & { readonly ids: () => TimelineItemId },
): Result<EditResult> {
  const rate = timeline.canvas.rate;
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const { item: clip, itemIndex, start, end } = found.value;
  if (clip.media.kind !== 'video') return err(InvalidMove(undefined, { detail: 'Only a video clip has a speed' }));
  const fitted =
    input.fit === 'length'
      ? { ...clip, speed: rampOver(input.speed, clip.duration.value, rate) }
      : mediaFitted(clip, input.speed, rate);
  if (!fitted || !clipMediaFits(fitted, rate)) return err(MediaTooShort({ clipId: clip.id }));
  const next = withSound(fitted, input);
  const items = [...videoItems(timeline)];
  items[itemIndex] = next;
  const length = next.duration.value;
  let edited = withVideoItems(timeline, items);
  if (length > end - start) edited = insertExtras(edited, end, length - (end - start), options.ids);
  if (length < end - start) edited = rippleExtras(edited, timeMap([{ start: start + length, end }]), options.ids);
  const index = positions(items).findIndex((entry) => entry.item.id === clip.id);
  const count = positions(items).length;
  const later = length === end - start ? [] : Array.from({ length: count - index }, (_, k) => index + 1 + k);
  const synced = resync(edited, {
    moved: later,
    reanchor: [index, ...later],
    ids: options.ids,
    ...(options.config ? { config: options.config } : {}),
  });
  return ok({ timeline: synced, changed: ['tracks', 'markers', 'captions'] });
}
