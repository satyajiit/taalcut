// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: one instant of a shot put on a slot's edge.
 *
 * A template slot may state a moment that must land where the slot starts or ends (`lands`: the edge, and what is
 * seen then, in the Analyst's words). The cast lists those statements; the AI looks at the slot's shot
 * (library.frameStrip) and states when the instant is as the slot's part (MOM1's `parts`, seconds of the shot's
 * file): the part's `to` for a moment on the slot's end, its `from` for one on its start. The edge is the
 * template's statement and the time is the AI's; no input is added for it (the Librarian's window has no room for
 * one: apps/desktop agent-prompt-budget.test.ts). This module applies that statement and nothing else: it never
 * looks for a moment, and a time is taken as stated.
 *
 * Where the instant sits: the frame at `at` is the last frame of the clip shown whole before the reel's transition
 * out of the slot begins (edge "end": `before` frames ahead of the cut; the slot's last frame at a hard cut), or
 * the first shown whole after the transition into the slot ends (edge "start": `after` frames past the cut; the
 * slot's first frame at a hard cut). The clip's in-point follows from that, the slot's length and its speed ramp.
 *
 * It applies while that shot fills that slot and the slot's whole window lies inside the shot's file. Otherwise the
 * pick stays as cast and the answer says why, with the numbers. On such a slot the instant is the more exact
 * statement, so it replaces a locked in-point and the window MOM1 would choose inside the part, and assembly's step
 * with the person (FIX-TRIM), the one step that moves an in-point by itself, runs before it. The answer is measured
 * from what was made (the picks of a cast, the clips of the new timelines), never from the request. Pure.
 */
import {
  FrameRate,
  keepsReelFootage,
  RationalTime,
  TimeRange,
  type SlotEdge,
  type SpeedRamp,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type { CastResult } from '../casting/engine';
import { consumes } from '../casting/slots';
import type { StatedPart } from '../casting/stated-parts';
import { candidateKey } from '../model/cast';
import { positions } from '../model/sequence';
import { sourceFrames } from '../model/speed';

export interface StatedMoment {
  readonly slotId: string;
  readonly shotId: string;
  /** When the instant is, in seconds of the shot's file. */
  readonly at: number;
  readonly edge: SlotEdge;
}

export interface MomentOutcome {
  readonly slotId: string;
  readonly shotId: string;
  readonly edge: SlotEdge;
  readonly at: number;
  readonly landed: boolean;
  /** Where in the video that frame shows, in seconds, when it landed. */
  readonly videoSeconds?: number;
  /** The stretch of the shot's file the slot plays, in seconds; absent when another shot (or none) fills it. */
  readonly playsShotFrom?: number;
  readonly playsShotTo?: number;
  /** When it did not land: what stands in the way, as facts. */
  readonly why?: string;
}

const s2 = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * The moments the stated parts state: a part of a person's slot whose template says a moment lands on its end and
 * that gives its `to`, or on its start (its `from`). Any other part is MOM1's alone.
 */
export function momentsOf(template: Template, parts: readonly StatedPart[] | undefined): StatedMoment[] {
  return (parts ?? []).flatMap((part) => {
    const slot = template.slots.find((item) => item.id === part.slotId);
    if (!slot?.lands || keepsReelFootage(slot)) return [];
    const at = slot.lands.edge === 'end' ? part.to : part.from;
    return at === undefined ? [] : [{ slotId: part.slotId, shotId: part.shotId, at, edge: slot.lands.edge }];
  });
}

/**
 * The slot's frame, counted from its start, at which the stated instant shows. `frames` is the length of the clip
 * that fills it when that is not the template's (LONG1: a slot lengthened by bars of the music), so the instant
 * stays on the transition out of a longer slot.
 */
export function landingFrame(template: Template, index: number, edge: SlotEdge, frames?: number): number {
  const slot = template.slots[index];
  if (!slot) return 0;
  const last = (frames ?? slot.duration.value) - 1;
  if (edge === 'start') return Math.max(0, Math.min(last, slot.transitionIn?.after.value ?? 0));
  return Math.max(0, last - (template.slots[index + 1]?.transitionIn?.before.value ?? 0));
}

interface Playing {
  readonly sourceStart: RationalTime;
  readonly available: TimeRange;
  readonly speed: SpeedRamp | null;
  /** The clip's frames and where it starts in the video, in canvas frames. */
  readonly frames: number;
  readonly start: number;
}

/** The in-point that puts the instant on the slot's frame `landing`, or why the slot's window can't lie there. */
function inPointFor(
  moment: StatedMoment,
  landing: number,
  playing: Pick<Playing, 'available' | 'speed' | 'frames'>,
  canvasRate: FrameRate,
): { readonly start: RationalTime } | { readonly why: string } {
  const rate = playing.available.start.rate;
  const fps = FrameRate.toNumber(rate);
  const canvasFps = FrameRate.toNumber(canvasRate);
  const first = playing.available.start.value;
  const end = TimeRange.end(playing.available).value;
  const at = Math.round(moment.at * fps);
  if (at < first || at >= end)
    return {
      why: `The shot’s file runs ${s2(first / fps)} to ${s2(end / fps)} s: ${moment.at} s is not in it.`,
    };
  const before = sourceFrames(playing.speed, landing) / canvasFps;
  const used = RationalTime.toSeconds(consumes(playing.frames, playing.speed, canvasRate));
  const start = at - Math.round(before * fps);
  if (start < first)
    return {
      why:
        `The slot plays ${s2(before)} s of the shot before this instant, and the file has ` +
        `${s2((at - first) / fps)} s before ${moment.at} s.`,
    };
  if (start + Math.ceil(used * fps - 1e-9) > end)
    return {
      why:
        `The slot plays ${s2(used - before)} s of the shot from this instant on, and the file has ` +
        `${s2((end - at) / fps)} s from ${moment.at} s.`,
    };
  return { start: RationalTime.of(start, rate) };
}

/** The cast with each stated moment's in-point, where that shot fills that slot and the window fits its file. */
export function landMoments(
  cast: CastResult,
  template: Template,
  moments: readonly StatedMoment[],
): CastResult {
  if (moments.length === 0) return cast;
  const indexOf = new Map(template.slots.map((slot, index) => [slot.id as string, index]));
  const variants = cast.variants.map((variant) => {
    const media = mediaByKey(variant);
    const slots = variant.slots.map((slot) => {
      // The part of the shot that fills the slot (the first, as MOM1 reads them).
      const moment = moments.find((item) => item.slotId === slot.slotId && item.shotId === slot.pick?.shotId);
      const index = indexOf.get(slot.slotId);
      const templateSlot = index === undefined ? undefined : template.slots[index];
      const ref = slot.pick ? media.get(candidateKey(slot.pick)) : undefined;
      if (!moment || !slot.pick || ref?.kind !== 'video') return slot;
      if (index === undefined || !templateSlot || keepsReelFootage(templateSlot)) return slot;
      const placed = inPointFor(
        moment,
        landingFrame(template, index, moment.edge),
        { available: ref.available, speed: templateSlot.speedRamp, frames: templateSlot.duration.value },
        template.canvas.rate,
      );
      // No sync point: the in-point is the statement's, and no later step moves it onto a motion peak.
      return 'start' in placed
        ? { ...slot, pick: { ...slot.pick, sourceStart: placed.start, syncPoint: null } }
        : slot;
    });
    return { ...variant, slots };
  });
  return { ...cast, variants };
}

/** A variant's media by candidate key, as assembly reads them. */
const mediaByKey = (variant: CastResult['variants'][number]) =>
  new Map(
    variant.media.map((ref) => [
      candidateKey({ assetId: ref.assetId, shotId: ref.kind === 'video' ? ref.shotId : null }),
      ref,
    ]),
  );

/** What became of one stated moment, measured from what fills its slot. */
function outcome(
  moment: StatedMoment,
  template: Template,
  playing: (Playing & { readonly shotId: string | null }) | null,
): MomentOutcome {
  const base = { slotId: moment.slotId, shotId: moment.shotId, edge: moment.edge, at: moment.at };
  const index = template.slots.findIndex((slot) => slot.id === moment.slotId);
  const slot = template.slots[index];
  if (!slot) return { ...base, landed: false, why: 'The template has no such slot.' };
  if (keepsReelFootage(slot))
    return { ...base, landed: false, why: 'This slot is the reel’s own footage: nothing is cast into it.' };
  if (!playing || playing.shotId !== moment.shotId)
    return {
      ...base,
      landed: false,
      why: 'Another shot fills this slot. To put a moment of this shot there, lock it to the slot (locked) as well.',
    };
  const rate = template.canvas.rate;
  const canvasFps = FrameRate.toNumber(rate);
  // LONG1: measured on the clip as long as it is, which a lengthened slot's is not the template's.
  const landing = landingFrame(template, index, moment.edge, playing.frames);
  const from = RationalTime.toSeconds(playing.sourceStart);
  const plays = {
    playsShotFrom: s2(from),
    playsShotTo: s2(from + RationalTime.toSeconds(consumes(playing.frames, playing.speed, rate))),
  };
  const shown = from + sourceFrames(playing.speed, landing) / canvasFps;
  if (Math.abs(shown - moment.at) <= 0.5 / canvasFps + 1e-6)
    return { ...base, landed: true, videoSeconds: s2((playing.start + landing) / canvasFps), ...plays };
  const placed = inPointFor(moment, landing, playing, rate);
  const why =
    'why' in placed
      ? placed.why
      : `The clip plays the shot from ${plays.playsShotFrom} s; from ${s2(RationalTime.toSeconds(placed.start))} s the instant would be there.`;
  return { ...base, landed: false, ...plays, why };
}

/** A cast's word on each stated moment: per variant, by slot (the moment of the shot that fills it first). */
export function castMoments(
  cast: CastResult,
  template: Template,
  moments: readonly StatedMoment[],
): Map<string, MomentOutcome>[] {
  return cast.variants.map((variant) => {
    const media = mediaByKey(variant);
    const out = new Map<string, MomentOutcome>();
    for (const moment of moments) {
      const slot = variant.slots.find((item) => item.slotId === moment.slotId);
      const templateSlot = template.slots.find((item) => item.id === moment.slotId);
      const ref = slot?.pick ? media.get(candidateKey(slot.pick)) : undefined;
      const playing =
        slot?.pick && templateSlot && ref?.kind === 'video'
          ? {
              shotId: slot.pick.shotId,
              sourceStart: slot.pick.sourceStart,
              available: ref.available,
              speed: templateSlot.speedRamp,
              frames: templateSlot.duration.value,
              start: templateSlot.start.value,
            }
          : null;
      const own = playing?.shotId === moment.shotId;
      if (own || !out.has(moment.slotId)) out.set(moment.slotId, outcome(moment, template, playing));
    }
    return out;
  });
}

const v1Clips = (timeline: Timeline) => {
  const v1 = timeline.tracks[0];
  return positions(v1?.kind === 'video' ? v1.items : []).flatMap((position) =>
    position.item.type === 'clip' ? [{ clip: position.item, start: position.start }] : [],
  );
};

/** `timeline.assemble`'s word on each stated moment, read from the timelines it made. */
export function placedMoments(
  timelines: readonly Timeline[],
  template: Template,
  moments: readonly StatedMoment[],
): (MomentOutcome & { readonly timelineId: string })[] {
  return timelines.flatMap((timeline) => {
    const clips = v1Clips(timeline);
    return moments.map((moment) => {
      const found = clips.find(({ clip }) => clip.slotId === moment.slotId && !clip.holdFrame);
      const playing =
        found && found.clip.media.kind === 'video'
          ? {
              shotId: found.clip.media.shotId,
              sourceStart: found.clip.sourceStart,
              available: found.clip.media.available,
              speed: found.clip.speed,
              frames: found.clip.duration.value,
              start: found.start,
            }
          : null;
      return { timelineId: timeline.id, ...outcome(moment, template, playing) };
    });
  });
}
