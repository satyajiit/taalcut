// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: the part of its file a scene plays, as the Trim tool draws it. Pure, from the clip, the editor's model and
 * (once it has loaded) the file's detail: the file's length and shots, the window the scene plays, and who stands
 * next to the scene. Positions in the file are media frames from its first frame (a clip's `sourceStart` is at the
 * media's rate), so what is sent to a command is the number that was drawn; lengths on the timeline are canvas
 * frames. A photo and a held moment have no part to pick: null.
 */
import {
  MIN_CLIP_FRAMES,
  type AssetDetail,
  type AssetId,
  type Clip,
  type FrameRate,
  type RationalTime,
  type ShotId,
  type SpeedRamp,
} from '@taalcut/core';
import type { ClipView, PositionView, TimelineModel } from '../model';
import { playedFrames, speedAtFrame } from './source-span';

/** One shot of the file, in media frames (end exclusive). */
export interface PartShot {
  readonly id: ShotId;
  readonly from: number;
  readonly to: number;
}

/** What stands beside the scene on the timeline, and how many canvas frames it can give up or take on. */
export interface Neighbour {
  /** A scene (with its number), an empty stretch, or something else on the track. */
  readonly kind: 'scene' | 'gap' | 'other';
  readonly number: number | null;
  readonly gives: number;
  readonly takes: number;
}

export interface PartModel {
  readonly assetId: AssetId;
  /** The shot the clip names; null when it names none. */
  readonly shotId: ShotId | null;
  /** The media's rate, and one of its frames in milliseconds. */
  readonly rate: FrameRate;
  readonly frameMs: number;
  /** The whole file, in media frames (end exclusive). */
  readonly fileFrom: number;
  readonly fileTo: number;
  /** The file's shots in order; empty until its detail has loaded (or when it names none). */
  readonly shots: readonly PartShot[];
  /** What the scene plays: from its first frame to where it stops (the end can fall inside a frame). */
  readonly from: number;
  readonly to: number;
  /** Whole media frames the scene needs, as the commands count them. */
  readonly needs: number;
  /** The scene on the timeline, in canvas frames. */
  readonly canvasRate: FrameRate;
  readonly cutIn: number;
  readonly cutOut: number;
  readonly ramp: SpeedRamp | null;
  /** Media frames in one canvas frame, at real speed. */
  readonly perCanvas: number;
  /** The speed where the scene begins and where it ends: 1 in real time. */
  readonly speedIn: number;
  readonly speedOut: number;
  readonly before: Neighbour | null;
  readonly after: Neighbour | null;
}

/** A time in frames at `rate` (not rounded). */
function framesAt(time: Pick<RationalTime, 'value' | 'rate'>, rate: FrameRate): number {
  return (time.value * time.rate.den * rate.num) / (time.rate.num * rate.den);
}

/** How far a neighbouring clip can grow towards the scene: what its own file still holds on that side. */
function room(item: Clip, side: 'start' | 'end', frames: number, canvas: FrameRate): number {
  if (item.media.kind !== 'video' || item.holdFrame) return Number.POSITIVE_INFINITY;
  const rate = item.sourceStart.rate;
  const perCanvas = (rate.num * canvas.den) / (rate.den * canvas.num);
  const first = framesAt(item.media.available.start, rate);
  if (side === 'start')
    return Math.max(
      0,
      Math.floor((item.sourceStart.value - first) / (speedAtFrame(item.speed, 0) * perCanvas)),
    );
  const last = first + framesAt(item.media.available.duration, rate);
  const stops = item.sourceStart.value + playedFrames(item.speed, frames) * perCanvas;
  return Math.max(0, Math.floor((last - stops) / (speedAtFrame(item.speed, frames) * perCanvas)));
}

function neighbour(
  model: TimelineModel,
  position: PositionView | undefined,
  side: 'start' | 'end',
): Neighbour | null {
  if (!position) return null;
  const frames = position.end - position.start;
  const gives = Math.max(0, frames - MIN_CLIP_FRAMES);
  const item = position.item;
  if (item.type === 'gap') return { kind: 'gap', number: null, gives, takes: Number.POSITIVE_INFINITY };
  if (item.type !== 'clip') return { kind: 'other', number: null, gives, takes: Number.POSITIVE_INFINITY };
  const number = model.clips.find((view) => view.item.id === item.id)?.number ?? null;
  return { kind: 'scene', number, gives, takes: room(item, side, frames, model.rate) };
}

/** The part `clip` plays, with the file's shots when `detail` is the file's and has loaded. */
export function partOf(clip: ClipView, model: TimelineModel, detail?: AssetDetail | null): PartModel | null {
  const item = clip.item;
  if (item.media.kind !== 'video' || item.holdFrame) return null;
  const rate = item.sourceStart.rate;
  const perCanvas = (rate.num * model.rate.den) / (rate.den * model.rate.num);
  const frames = clip.end - clip.start;
  const played = playedFrames(item.speed, frames) * perCanvas;
  const fileFrom = framesAt(item.media.available.start, rate);
  const fileTo = fileFrom + framesAt(item.media.available.duration, rate);
  const shots =
    detail && detail.asset.id === item.media.assetId
      ? [...detail.shots]
          .sort((a, b) => a.index - b.index)
          .map((shot) => {
            const from = Math.round(framesAt(shot.range.start, rate));
            return { id: shot.id, from, to: from + Math.round(framesAt(shot.range.duration, rate)) };
          })
      : [];
  return {
    assetId: item.media.assetId,
    shotId: item.media.shotId,
    rate,
    frameMs: (1000 * rate.den) / rate.num,
    fileFrom,
    fileTo,
    shots,
    from: item.sourceStart.value,
    to: item.sourceStart.value + played,
    needs: Math.max(1, Math.ceil(played - 1e-6)),
    canvasRate: model.rate,
    cutIn: clip.start,
    cutOut: clip.end,
    ramp: item.speed,
    perCanvas,
    speedIn: speedAtFrame(item.speed, 0),
    speedOut: speedAtFrame(item.speed, frames),
    // The neighbour before grows at its end, the one after at its start.
    before: neighbour(model, model.positions[clip.index - 1], 'end'),
    after: neighbour(model, model.positions[clip.index + 1], 'start'),
  };
}

/** Milliseconds from the file's first frame to media frame `frame`. */
export const msAt = (part: Pick<PartModel, 'frameMs' | 'fileFrom'>, frame: number): number =>
  (frame - part.fileFrom) * part.frameMs;

/** Where media frame `frame` sits along the file, 0 to 1, for drawing. */
export function fractionAt(part: Pick<PartModel, 'fileFrom' | 'fileTo'>, frame: number): number {
  const length = part.fileTo - part.fileFrom;
  return length > 0 ? Math.min(1, Math.max(0, (frame - part.fileFrom) / length)) : 0;
}

/** The shot media frame `frame` is in: the last one that starts at or before it. */
export function shotAtFrame(part: Pick<PartModel, 'shots'>, frame: number): PartShot | null {
  let found: PartShot | null = part.shots[0] ?? null;
  for (const shot of part.shots) {
    if (shot.from <= frame) found = shot;
    else break;
  }
  return found;
}

/** Media frames in half a second, and canvas frames in half a second: the larger step. */
export const halfSecond = (rate: FrameRate): number => Math.max(1, Math.round(rate.num / rate.den / 2));
