// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The review's cut edits (BRK1-CMD) as pure functions, like slot-edits.ts: move the cut at a slot's start, or add
 * one inside a slot. Either cut is the person's (`cut.method: 'user'`), lands on a canvas frame (or a beat), and
 * leaves at least one frame on each side. No other cut moves, so every other slot keeps its beat; overlays and
 * tiles follow by start time (follow.ts).
 */
import {
  err,
  ok,
  RationalTime,
  TemplateCutOutOfRange,
  TemplateFirstSlotCut,
  ValidationError,
  type CutSnap,
  type Result,
  type SlotId,
  type Template,
  type TemplateSlot,
} from '@taalcut/core';
import { NoBeatMap, SlotNotFound } from '../errors';
import {
  CUT_DOUBTS,
  FADE_DOUBTS,
  INTENT_DOUBTS,
  MOTION_DOUBTS,
  onlyDoubts,
  withDoubts,
  withoutDoubts,
} from './doubts';
import { fitRamp, fitTransition, retimed, USER_CUT } from './follow';
import { anchorAt, beatFrames } from './timing';

/** Template v1's limit (templateSchema). */
const MAX_SLOTS = 200;

export interface CutInput {
  readonly slotId: SlotId;
  /** moveCut's `to`, split's `at`. */
  readonly at: RationalTime;
  readonly snap: CutSnap;
}

/** The frame a cut lands on, between `low` and `high` inclusive: the nearest frame, or the nearest beat there. */
function landing(
  template: Template,
  at: RationalTime,
  low: number,
  high: number,
  snap: CutSnap,
): Result<number> {
  const rate = template.canvas.rate;
  let frame: number;
  try {
    frame = RationalTime.toFrames(at, rate, 'round');
  } catch {
    // A time no frame number can hold: certainly outside the slot.
    return err(TemplateCutOutOfRange());
  }
  if (snap === 'beat') {
    if (!template.beatMap) return err(NoBeatMap());
    const beats = beatFrames(template.beatMap, rate).filter((beat) => beat >= low && beat <= high);
    if (beats.length === 0) return err(TemplateCutOutOfRange());
    // The nearest beat; the earlier one on a tie.
    return ok(beats.reduce((best, beat) => (Math.abs(beat - frame) < Math.abs(best - frame) ? beat : best)));
  }
  return frame >= low && frame <= high ? ok(frame) : err(TemplateCutOutOfRange());
}

function frames(template: Template, slot: TemplateSlot) {
  const rate = template.canvas.rate;
  const start = RationalTime.toFrames(slot.start, rate);
  return { start, end: start + RationalTime.toFrames(slot.duration, rate) };
}

/** The slot after `index` with its transition in trimmed to `before`, the new length of the slot before it. */
function trimNext(slots: TemplateSlot[], index: number, before: RationalTime): void {
  const next = slots[index + 1];
  if (next?.transitionIn)
    slots[index + 1] = { ...next, transitionIn: fitTransition(next.transitionIn, before, next.duration) };
}

/**
 * Moves the cut at the start of `slotId` (the end of the slot before it) to `at`. The slot before takes or gives
 * the time; the slot's cut becomes the person's, its anchor is the new start's beat, and a ramp counted from its
 * old start goes. Answers the slot's cut and fade doubts and the fade doubt of the slot before.
 */
export function moveCut(template: Template, input: CutInput): Result<Template> {
  const index = template.slots.findIndex((slot) => slot.id === input.slotId);
  if (index < 0) return err(SlotNotFound());
  if (index === 0) return err(TemplateFirstSlotCut());
  const rate = template.canvas.rate;
  const previous = template.slots[index - 1]!;
  const slot = template.slots[index]!;
  const before = frames(template, previous);
  const own = frames(template, slot);
  const landed = landing(template, input.at, before.start + 1, own.end - 1, input.snap);
  if (!landed.ok) return landed;
  const cut = landed.value;
  const previousLength = RationalTime.of(cut - before.start, rate);
  const length = RationalTime.of(own.end - cut, rate);
  const slots = [...template.slots];
  slots[index - 1] = withoutDoubts(
    {
      ...previous,
      duration: previousLength,
      speedRamp: fitRamp(previous.speedRamp, previousLength),
      transitionIn: fitTransition(
        previous.transitionIn,
        previous.transitionIn?.before ?? previousLength,
        previousLength,
      ),
    },
    FADE_DOUBTS,
  );
  slots[index] = withoutDoubts(
    {
      ...slot,
      start: RationalTime.of(cut, rate),
      duration: length,
      cut: USER_CUT,
      beatAnchor: template.beatMap ? anchorAt(beatFrames(template.beatMap, rate), cut, rate) : null,
      transitionIn: fitTransition(slot.transitionIn, previousLength, length),
      speedRamp: cut === own.start ? slot.speedRamp : null,
    },
    [...CUT_DOUBTS, ...FADE_DOUBTS],
  );
  trimNext(slots, index, length);
  return ok(retimed(template, slots, rate));
}

/**
 * Adds a cut at `at` inside `slotId`. The first half keeps the slot (its id, cut, anchor, approval and doubts);
 * the second is `newId`, with the same role and intent (and the intent's doubt), unapproved, its cut the person's,
 * no name, transition in or ramp.
 */
export function splitSlot(template: Template, input: CutInput, newId: SlotId): Result<Template> {
  const index = template.slots.findIndex((slot) => slot.id === input.slotId);
  if (index < 0) return err(SlotNotFound());
  if (template.slots.length >= MAX_SLOTS)
    return err(
      ValidationError({ field: 'slotId' }, { detail: `A template holds at most ${MAX_SLOTS} slots` }),
    );
  const rate = template.canvas.rate;
  const slot = template.slots[index]!;
  const own = frames(template, slot);
  const landed = landing(template, input.at, own.start + 1, own.end - 1, input.snap);
  if (!landed.ok) return landed;
  const cut = landed.value;
  const firstLength = RationalTime.of(cut - own.start, rate);
  const secondLength = RationalTime.of(own.end - cut, rate);
  const first: TemplateSlot = {
    ...slot,
    duration: firstLength,
    speedRamp: fitRamp(slot.speedRamp, firstLength),
    transitionIn: fitTransition(slot.transitionIn, slot.transitionIn?.before ?? firstLength, firstLength),
  };
  const second = withDoubts(
    {
      ...slot,
      id: newId,
      name: null,
      start: RationalTime.of(cut, rate),
      duration: secondLength,
      cut: USER_CUT,
      approved: false,
      beatAnchor: template.beatMap ? anchorAt(beatFrames(template.beatMap, rate), cut, rate) : null,
      transitionIn: null,
      speedRamp: null,
    },
    onlyDoubts(slot.doubts, [...INTENT_DOUBTS, ...MOTION_DOUBTS]),
  );
  const slots = [...template.slots.slice(0, index), first, second, ...template.slots.slice(index + 1)];
  trimNext(slots, index + 1, secondLength);
  return ok(retimed(template, slots, rate));
}
