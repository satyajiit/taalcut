// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-MOT: the camera's measured move on the fake's review reels. Every slot was measured as its motion; one read
 * unsurely leaves its motion unknown, as the breakdown does, for the review to ask. Made-up rates in the move's
 * direction.
 */
import type { Template } from '@taalcut/core';

type Slot = Template['slots'][number];
type Motion = Slot['intent']['motion'];

/** A measure the classifier wasn't sure of: its label and confidence. */
export interface UnsureMove {
  readonly label: Motion;
  readonly confidence: number;
}

export const measureOf = (label: Motion, confidence: number): NonNullable<Slot['motionMeasure']> => ({
  panX: label === 'pan' || label === 'tracking' ? 0.12 : 0,
  panY: label === 'tilt' ? 0.1 : 0,
  scale: label === 'push-in' ? 0.08 : label === 'pull-out' ? -0.08 : 0,
  rotation: 0,
  jitter: label === 'handheld' ? 0.004 : 0.0002,
  label,
  confidence,
  version: 1,
});

/** The slot with its measure: surely its motion, or `unsure`'s reading with the motion left unknown. */
export function withMeasure(slot: Slot, unsure?: UnsureMove): Slot {
  return unsure
    ? {
        ...slot,
        intent: { ...slot.intent, motion: null },
        motionMeasure: measureOf(unsure.label, unsure.confidence),
      }
    : { ...slot, motionMeasure: measureOf(slot.intent.motion, 0.86) };
}
