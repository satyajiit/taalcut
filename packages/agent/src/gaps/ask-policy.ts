// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: when the gaps step stops to ask, pure. The owner's 13-shot template met 12 clips: one shot had nothing,
 * the opening shot's clip was unsure, and at "Only before render" the defaults applied in seconds with no question.
 * Now every level but autopilot asks when it matters: a shot has no clip, the opening shot's clip is unsure, a shot
 * that carries the template's text or graphics has an unsure clip, or more than a fifth of the shots are unsure.
 * "Ask me at every step" asks about any gap, as before; autopilot never asks, and says what it did instead.
 */
import type { GapAskReason } from '@taalcut/core';
import type { AutonomyLevel } from '../events';
import type { GapSlot, GapTimeline } from './gap-types';
import { openSlots } from './proposals';

/** More unsure clips than this share of the video's shots asks. */
export const MANY_UNSURE = 0.2;

/** The shots a timeline's video has: the reader's count, else every listed slot not dropped. */
export function shotCount(timeline: GapTimeline): number {
  return Math.max(1, timeline.slotCount ?? timeline.slots.filter((s) => s.state !== 'dropped').length);
}

const isOpening = (slot: GapSlot) => slot.number === 1;
const carries = (slot: GapSlot) => (slot.carries?.length ?? 0) > 0;

/** Why these timelines' gaps are worth a question, in GAP_ASK_REASONS order; empty: nothing that needs one. */
export function askReasons(timelines: readonly GapTimeline[]): GapAskReason[] {
  const found = new Set<GapAskReason>();
  for (const timeline of timelines) {
    const open = openSlots(timeline);
    const weak = open.filter((slot) => slot.state === 'weak');
    if (open.some((slot) => slot.state === 'empty')) found.add('empty');
    if (weak.some(isOpening)) found.add('opening');
    if (weak.some((slot) => !isOpening(slot) && carries(slot))) found.add('carries');
    if (weak.length / shotCount(timeline) > MANY_UNSURE) found.add('manyUnsure');
  }
  const order: readonly GapAskReason[] = ['empty', 'opening', 'carries', 'manyUnsure'];
  return order.filter((reason) => found.has(reason));
}

/** Whether the run asks at this level: always at every step, never on autopilot, else when a reason says so. */
export function asksAt(autonomy: AutonomyLevel, reasons: readonly GapAskReason[]): boolean {
  if (autonomy === 'every-step') return true;
  if (autonomy === 'autopilot') return false;
  return reasons.length > 0;
}
