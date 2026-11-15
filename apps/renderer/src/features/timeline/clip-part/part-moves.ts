// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: where the part can go, and which command takes it there. Pure.
 *
 * Moving the whole part keeps the scene's place and length. It stays inside one shot of the file, as
 * `timeline.slipClip` holds it (a scene never plays across a cut in its own footage unless a trim put it there):
 * inside the clip's shot it is a slip; landing in another shot of the same file that is long enough is
 * `timeline.swapClip` to that shot at the chosen start. Between two shots the part sits in whichever is nearer.
 *
 * Moving an end is `timeline.trimClip` with its rules: the cut moves, the neighbour gives or takes the frames,
 * the video's last edge makes the video longer or shorter, and the cut lands on the beat when there is one. The
 * video's first edge cannot be trimmed (that command would move the part instead), so it has no range here.
 */
import { EDITOR_COMMANDS, MIN_CLIP_FRAMES, TIMELINE_COMMANDS, type TimelineItemId } from '@taalcut/core';
import type { TimelineModel } from '../model';
import type { PartModel, PartShot } from './part-model';
import { playedFrames } from './source-span';

export type PartEdge = 'start' | 'end';

/** A stretch of first frames the part may start on, inside one shot. */
interface MoveSpan {
  readonly low: number;
  readonly high: number;
  readonly shot: PartShot | null;
  /** The shot the clip plays now (or the whole file when its shots aren't known). */
  readonly home: boolean;
}

export interface MoveTarget {
  /** The part's first media frame. */
  readonly from: number;
  readonly shot: PartShot | null;
  /** What takes it there; null when it is where the scene plays already. */
  readonly command: 'slip' | 'swap' | null;
}

export function moveSpans(part: PartModel): MoveSpan[] {
  const last = part.fileTo - part.needs;
  const home = part.shots.find((shot) => shot.id === part.shotId);
  // No shots to go by (the file hasn't loaded, or the clip names none): the whole file, and the command decides.
  if (!home)
    return [
      { low: Math.min(part.fileFrom, part.from), high: Math.max(last, part.from), shot: null, home: true },
    ];
  const spans: MoveSpan[] = [];
  for (const shot of part.shots) {
    if (shot.id === home.id) {
      // As far outside its shot as a trim already put it, and no further (slipClip's own rule).
      const low = Math.min(shot.from, part.from);
      spans.push({ low, high: Math.max(Math.min(shot.to - part.needs, last), part.from), shot, home: true });
    } else if (shot.to - shot.from >= part.needs && shot.from <= last) {
      spans.push({ low: shot.from, high: Math.min(shot.to - part.needs, last), shot, home: false });
    }
  }
  return spans;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function targetIn(part: PartModel, span: MoveSpan, from: number): MoveTarget {
  return { from, shot: span.shot, command: !span.home ? 'swap' : from === part.from ? null : 'slip' };
}

/** The nearest place the part can start to media frame `raw`: ties stay in the clip's own shot. */
export function moveTo(part: PartModel, raw: number): MoveTarget {
  const wanted = Math.round(raw);
  let best: { span: MoveSpan; from: number; off: number } | null = null;
  for (const span of moveSpans(part)) {
    const from = clamp(wanted, span.low, span.high);
    const off = Math.abs(from - wanted);
    if (!best || off < best.off || (off === best.off && span.home && !best.span.home))
      best = { span, from, off };
  }
  return best ? targetIn(part, best.span, best.from) : { from: part.from, shot: null, command: null };
}

/**
 * A step of `delta` media frames from `from`. A step that would leave its shot stops at the shot's last place
 * first; the next one goes on to the nearest place further along (the next shot the part fits in). At the file's
 * ends it stays put.
 */
export function moveStep(part: PartModel, from: number, delta: number): MoveTarget {
  const wanted = Math.round(from + delta);
  const spans = moveSpans(part);
  if (spans.some((span) => wanted >= span.low && wanted <= span.high)) return moveTo(part, wanted);
  const own = spans.find((span) => from >= span.low && from <= span.high);
  const limit = own ? (delta > 0 ? own.high : own.low) : from;
  if (limit !== from) return moveTo(part, limit);
  const ahead = spans
    .map((span) => (delta > 0 ? span.low : span.high))
    .filter((place) => (delta > 0 ? place > from : place < from))
    .sort((a, b) => (delta > 0 ? a - b : b - a))[0];
  return moveTo(part, ahead ?? from);
}

/** The first or last place in the stretch the part is in now. */
export function moveToEnd(part: PartModel, from: number, end: 'first' | 'last'): MoveTarget {
  const own = moveSpans(part).find((span) => from >= span.low && from <= span.high);
  return own ? moveTo(part, end === 'first' ? own.low : own.high) : moveTo(part, from);
}

/** The cuts a trim can land on: the beats (and half beats when scenes are shorter than a beat); null: any frame. */
export interface CutGrid {
  readonly points: readonly number[];
  /** How far from where it was asked a cut still goes to a grid point, in canvas frames. */
  readonly reach: number;
}

export function cutGrid(model: TimelineModel): CutGrid | null {
  if (model.beats.length === 0) return null;
  const points = new Set(model.beats);
  const lengths = model.positions.map((position) => position.end - position.start).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? model.beatFrames;
  if (median < model.beatFrames)
    model.beats.slice(1).forEach((beat, index) => points.add(Math.round((model.beats[index]! + beat) / 2)));
  return { points: [...points].sort((a, b) => a - b), reach: model.beatFrames * 2 };
}

/**
 * What stops an end going further: the clip's own footage runs out, the scene next to it is as short as it gets,
 * the scene itself is, or the scene next to it has no footage to fill the room.
 */
export type EdgeStop = 'footage' | 'neighbour' | 'shortest' | 'neighbourFootage';

export interface EdgeTarget {
  /** Canvas frames for `timeline.trimClip`: positive makes the scene longer at that edge. */
  readonly by: number;
  /** The part as it would then be, in media frames. */
  readonly from: number;
  readonly to: number;
  /** Set when the end was asked to go further than it can: why it stays here. */
  readonly stop: EdgeStop | null;
}

export interface EdgeRange {
  readonly min: number;
  readonly max: number;
  /** What sets each limit. */
  readonly atMin: EdgeStop;
  readonly atMax: EdgeStop;
}

/** How far the edge can go, as `by`; null for the video's first edge, which can't be trimmed. */
export function edgeRange(part: PartModel, edge: PartEdge): EdgeRange | null {
  const shorter = Math.max(0, part.cutOut - part.cutIn - MIN_CLIP_FRAMES);
  const beside = edge === 'start' ? part.before : part.after;
  if (edge === 'start' && !beside) return null;
  const footage =
    edge === 'start'
      ? Math.floor((part.from - part.fileFrom) / (part.speedIn * part.perCanvas))
      : Math.floor((part.fileTo - part.to) / (part.speedOut * part.perCanvas) + 1e-6);
  // The video's last edge takes nothing from anyone: the video gets longer or shorter.
  const gives = beside ? beside.gives : Number.POSITIVE_INFINITY;
  const takes = beside ? beside.takes : Number.POSITIVE_INFINITY;
  return {
    min: -Math.min(shorter, takes),
    max: Math.max(0, Math.min(footage, gives)),
    atMin: shorter <= takes ? 'shortest' : 'neighbourFootage',
    atMax: footage <= gives ? 'footage' : 'neighbour',
  };
}

/** The part after a trim of `by` at `edge`. */
export function edgeAt(
  part: PartModel,
  edge: PartEdge,
  by: number,
  stop: EdgeStop | null = null,
): EdgeTarget {
  if (edge === 'start')
    return { by, from: part.from - by * part.speedIn * part.perCanvas, to: part.to, stop };
  const played = playedFrames(part.ramp, part.cutOut - part.cutIn + by) * part.perCanvas;
  return { by, from: part.from, to: part.from + played, stop };
}

/** The cut's place on the timeline (canvas frames) after a trim of `by`, and the limits it moves between. */
function cutOf(part: PartModel, edge: PartEdge, by: number, range: EdgeRange) {
  const sign = edge === 'end' ? 1 : -1;
  const cut = edge === 'end' ? part.cutOut : part.cutIn;
  const ends = [cut + sign * range.min, cut + sign * range.max];
  return { sign, cut, now: cut + sign * by, low: Math.min(...ends), high: Math.max(...ends) };
}

/** The edge where the pointer asks it to be (media frame `raw`), on the beat when the video has one. */
export function edgeTo(part: PartModel, edge: PartEdge, raw: number, grid: CutGrid | null): EdgeTarget {
  const range = edgeRange(part, edge);
  if (!range) return edgeAt(part, edge, 0);
  const { sign, cut, low, high } = cutOf(part, edge, 0, range);
  const speed = edge === 'end' ? part.speedOut : part.speedIn;
  const asked = Math.round(cut + (raw - (edge === 'end' ? part.to : part.from)) / (speed * part.perCanvas));
  const wanted = clamp(asked, low, high);
  // Asked past a limit: the scene was to grow past `max`, or shrink past `min`.
  const grows = sign * (asked - cut);
  const stop = grows > range.max ? range.atMax : grows < range.min ? range.atMin : null;
  if (wanted === cut || !grid) return edgeAt(part, edge, sign * (wanted - cut), stop);
  // As the trim command lands it: the nearest beat that fits, or where it was asked when none is near.
  const near = grid.points
    .filter((point) => point >= low && point <= high && Math.abs(point - wanted) <= grid.reach)
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)[0];
  return edgeAt(part, edge, sign * ((near ?? wanted) - cut), stop);
}

/**
 * The edge one step along the video (`direction` 1 is later) from a trim of `by`: a frame, or half a second with
 * `large`; with a beat, the next beat either way.
 */
export function edgeStep(
  part: PartModel,
  edge: PartEdge,
  by: number,
  direction: -1 | 1,
  large: boolean,
  grid: CutGrid | null,
): EdgeTarget {
  const range = edgeRange(part, edge);
  if (!range) return edgeAt(part, edge, 0);
  const { sign, cut, now, low, high } = cutOf(part, edge, by, range);
  const free =
    now + direction * (large ? Math.max(1, Math.round(part.canvasRate.num / part.canvasRate.den / 2)) : 1);
  const beat = grid
    ? direction > 0
      ? grid.points.find((point) => point > now)
      : grid.points.findLast((point) => point < now)
    : undefined;
  const next = beat ?? free;
  // A beat past the limit is out of reach: the edge stays where it is rather than land off the beat.
  const landed = beat !== undefined && (beat < low || beat > high) ? now : clamp(next, low, high);
  // A step that went nowhere says why: the scene was to grow (the cut moving its own way) or to shrink.
  const stop = landed !== now ? null : sign * direction > 0 ? range.atMax : range.atMin;
  return edgeAt(part, edge, sign * (landed - cut), stop);
}

export interface PartCommand {
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

/** The command that moves the part to `target`; null when there is nothing to change. */
export function moveCommand(part: PartModel, clipId: TimelineItemId, target: MoveTarget): PartCommand | null {
  if (!target.command) return null;
  const sourceStart = { value: target.from, rate: { num: part.rate.num, den: part.rate.den } };
  if (target.command === 'slip') return { name: EDITOR_COMMANDS.slipClip, payload: { clipId, sourceStart } };
  if (!target.shot) return null;
  return {
    name: TIMELINE_COMMANDS.swapClip,
    payload: {
      clipId,
      media: { assetId: part.assetId, shotId: target.shot.id },
      sourceStart,
      // The person found this part themselves: neither the cast's alternate nor the agent's pick.
      from: 'search',
    },
  };
}
