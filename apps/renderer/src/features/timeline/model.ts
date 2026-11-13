// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor's view of a Timeline v1 document (P2-M7): where each clip, gap
 * and text item sits in canvas frames, the beat grid in canvas frames, and
 * what the cast says about each clip (an AI pick, your swap). Pure, so the
 * tracks, the inspector and the tests read one shape. Timeline times are
 * whole frames at `canvas.rate` (core's timeline rules), so a duration's
 * value is its frame count; `toFrames` rescales anything at another rate.
 */
import type {
  AssetId,
  AuthoredProgramItem,
  Clip,
  FrameRate,
  Gap,
  RationalTime,
  ShotId,
  SlotCast,
  Template,
  TemplateSlot,
  TextItem,
  Timeline,
  TimelineItemId,
  TransitionItem,
} from '@taalcut/core';

export interface PositionView {
  readonly item: Clip | Gap | AuthoredProgramItem;
  /** Index among V1's clips and gaps (transitions don't count): timeline.moveClip's `toIndex`. */
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

export interface ClipView extends PositionView {
  readonly item: Clip;
  /** 1-based among the clips, for "Clip 3". */
  readonly number: number;
  /** The template slot it fills (0-based), when the timeline came from a template. */
  readonly slotIndex: number | null;
  readonly slot: TemplateSlot | null;
  readonly cast: SlotCast | null;
  /** Who chose what plays here: the AI's pick, your swap, or nobody (no cast). */
  readonly chosenBy: 'ai' | 'you' | null;
}

export interface TextView {
  readonly item: TextItem;
  readonly trackId: string;
  readonly start: number;
  readonly end: number;
}

export interface TimelineModel {
  readonly rate: FrameRate;
  readonly total: number;
  readonly positions: readonly PositionView[];
  readonly clips: readonly ClipView[];
  readonly texts: readonly TextView[];
  readonly transitions: readonly { readonly item: TransitionItem; readonly at: number }[];
  /** Every beat, in canvas frames, increasing. Empty without a beat map. */
  readonly beats: readonly number[];
  /** Indices into `beats` that start a bar. */
  readonly downbeats: ReadonlySet<number>;
  /** One beat in frames (the median gap), or a second when there is no beat map. */
  readonly beatFrames: number;
  readonly bpm: number | null;
  readonly beatsPerBar: number;
}

export const fpsOf = (rate: FrameRate): number => rate.num / rate.den;

/** The file and shot a clip plays (a photo has no shot). */
export function mediaOf(clip: Clip): { readonly assetId: AssetId; readonly shotId: ShotId | null } {
  return { assetId: clip.media.assetId, shotId: clip.media.kind === 'video' ? clip.media.shotId : null };
}

/** A time as whole frames at `rate` (rounded). */
export function toFrames(time: Pick<RationalTime, 'value' | 'rate'>, rate: FrameRate): number {
  if (time.rate.num === rate.num && time.rate.den === rate.den) return time.value;
  return Math.round((time.value * time.rate.den * rate.num) / (time.rate.num * rate.den));
}

/** A text track's text items; motion graphics (Timeline v2) get their own lane once the ui-make lane draws them. */
function textItemsOf(items: Extract<Timeline['tracks'][number], { kind: 'text' }>['items']): TextItem[] {
  return items.filter((item): item is TextItem => item.type === 'text');
}

/** `frames` at `rate` as a RationalTime (what command payloads carry). */
export const atRate = (frames: number, rate: FrameRate): RationalTime => ({
  value: Math.round(frames),
  rate: { num: rate.num, den: rate.den },
});

function beatGrid(timeline: Timeline): Pick<TimelineModel, 'beats' | 'downbeats' | 'beatFrames' | 'bpm'> {
  const rate = timeline.canvas.rate;
  const map = timeline.beatMap;
  if (!map || map.beats.length === 0) {
    return { beats: [], downbeats: new Set(), beatFrames: Math.round(fpsOf(rate)), bpm: null };
  }
  const beats = map.beats.map((beat) => toFrames(beat, rate));
  const gaps = beats
    .slice(1)
    .map((frame, i) => frame - beats[i]!)
    .sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : Math.round(fpsOf(rate));
  return { beats, downbeats: new Set(map.downbeats), beatFrames: Math.max(1, median), bpm: map.bpm };
}

export function buildModel(timeline: Timeline, template?: Template | null): TimelineModel {
  const rate = timeline.canvas.rate;
  const video = timeline.tracks.find((track) => track.kind === 'video');
  const castByClip = new Map<TimelineItemId, SlotCast>();
  for (const slot of timeline.cast?.slots ?? []) if (slot.clipId) castByClip.set(slot.clipId, slot);
  const slotIndex = new Map((template?.slots ?? []).map((slot, index) => [slot.id, index] as const));

  const positions: PositionView[] = [];
  const clips: ClipView[] = [];
  const transitions: { item: TransitionItem; at: number }[] = [];
  let at = 0;
  for (const item of video?.kind === 'video' ? video.items : []) {
    if (item.type === 'transition') {
      transitions.push({ item, at });
      continue;
    }
    const length = toFrames(item.duration, rate);
    const base = { index: positions.length, start: at, end: at + length };
    at += length;
    if (item.type === 'gap' || item.type === 'program') {
      positions.push({ ...base, item });
      continue;
    }
    const cast = castByClip.get(item.id) ?? null;
    const index = item.slotId ? slotIndex.get(item.slotId) : undefined;
    const view: ClipView = {
      ...base,
      item,
      number: clips.length + 1,
      slotIndex: index ?? null,
      slot: index === undefined ? null : (template?.slots[index] ?? null),
      cast,
      chosenBy: cast ? (cast.note === 'userPick' ? 'you' : cast.pick ? 'ai' : null) : null,
    };
    positions.push(view);
    clips.push(view);
  }

  const texts: TextView[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'text') continue;
    for (const item of textItemsOf(track.items)) {
      const start = toFrames(item.start, rate);
      texts.push({ item, trackId: track.id, start, end: start + toFrames(item.duration, rate) });
    }
  }

  return {
    rate,
    total: at,
    positions,
    clips,
    texts,
    transitions,
    ...beatGrid(timeline),
    beatsPerBar: timeline.beatMap?.beatsPerBar ?? 4,
  };
}

/** The clip on screen at `frame` (the last one at the very end). */
export function clipAt(model: TimelineModel, frame: number): ClipView | null {
  return model.clips.find((clip) => frame >= clip.start && frame < clip.end) ?? model.clips.at(-1) ?? null;
}

/** The nearest beat to `frame`, or `frame` itself without a grid or when none is within `reach` frames. */
export function snapToBeat(model: TimelineModel, frame: number, reach = Number.POSITIVE_INFINITY): number {
  let best = frame;
  let distance = reach;
  for (const beat of model.beats) {
    const d = Math.abs(beat - frame);
    // Ties go earlier, as timeline re-sync does.
    if (d < distance) {
      best = beat;
      distance = d;
    }
    if (beat > frame + distance) break;
  }
  return best;
}

/** Bar and beat (both 1-based) at `frame`, or null without a beat map. */
export function barBeat(model: TimelineModel, frame: number): { bar: number; beat: number } | null {
  if (model.beats.length === 0) return null;
  let index = 0;
  while (index + 1 < model.beats.length && model.beats[index + 1]! <= frame) index += 1;
  const perBar = model.beatsPerBar;
  return { bar: Math.floor(index / perBar) + 1, beat: (index % perBar) + 1 };
}

/** The previous or next beat from `frame` (a frame step without a grid). */
export function stepBeat(model: TimelineModel, frame: number, direction: -1 | 1): number {
  if (model.beats.length === 0) return frame + direction * model.beatFrames;
  if (direction > 0) return model.beats.find((beat) => beat > frame) ?? model.total;
  return model.beats.findLast((beat) => beat < frame) ?? 0;
}

/** Beats inside [start, end), for "6 beats". */
export function beatsBetween(model: TimelineModel, start: number, end: number): number {
  if (model.beats.length === 0) return Math.round((end - start) / model.beatFrames);
  return Math.max(0, Math.round((end - start) / model.beatFrames));
}
