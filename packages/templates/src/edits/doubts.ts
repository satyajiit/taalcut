// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Doubts (BRK1 §1) as the edits resolve them. A doubt goes when an edit answers it, not on any edit: moving a cut
 * answers "is this a cut?", a new description answers "is it vague?", but a rename answers neither. The table is in
 * the SPEC ("Review commands"). An item left with no doubt drops the field, since absent means none.
 */
import type { Doubt, DoubtReason } from '@taalcut/core';

/** About the cut at a slot's start. */
export const CUT_DOUBTS: readonly DoubtReason[] = ['cutUnsure', 'cutMaybeTransition'];
/** About the slot's length: mostly a fade's black or white. */
export const FADE_DOUBTS: readonly DoubtReason[] = ['fadeTail'];
/** About the slot's description. */
export const INTENT_DOUBTS: readonly DoubtReason[] = ['intentVague', 'intentGeneralised'];
/** FRM1-MOT: about the camera's move, which travels with the intent (a split's halves, a merge's chosen slot). */
export const MOTION_DOUBTS: readonly DoubtReason[] = ['motionUnsure'];

interface WithDoubts {
  readonly doubts?: readonly Doubt[] | undefined;
}

/** `item` without the doubts of these reasons (every doubt when `reasons` is absent). */
export function withoutDoubts<T extends WithDoubts>(item: T, reasons?: readonly DoubtReason[]): T {
  if (!item.doubts) return item;
  const kept = reasons ? item.doubts.filter((doubt) => !reasons.includes(doubt.reason)) : [];
  if (kept.length === item.doubts.length) return item;
  const { doubts: _dropped, ...rest } = item;
  return (kept.length > 0 ? { ...rest, doubts: kept } : rest) as T;
}

/** Only the doubts of these reasons (for a slot made from another: a split's second half, a merge). */
export function onlyDoubts(doubts: readonly Doubt[] | undefined, reasons: readonly DoubtReason[]): Doubt[] {
  return (doubts ?? []).filter((doubt) => reasons.includes(doubt.reason));
}

/** `item` with exactly `doubts`, the field dropped when there are none. */
export function withDoubts<T extends WithDoubts>(item: T, doubts: readonly Doubt[]): T {
  const { doubts: _old, ...rest } = item;
  return (doubts.length > 0 ? { ...rest, doubts: [...doubts] } : rest) as T;
}

export function hasDoubt(item: WithDoubts, reason: DoubtReason): boolean {
  return item.doubts?.some((doubt) => doubt.reason === reason) ?? false;
}
