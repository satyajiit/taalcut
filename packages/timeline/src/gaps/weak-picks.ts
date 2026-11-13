// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GAPS: a weak pick, as the gaps step sees it. A slot whose clip casting is unsure of (confidence under its own
 * line, `confidence.rerankBelow`) is a gap too: it can swap to one of its next-best candidates (the cast's
 * alternates, best fit first), keep its clip, or take the fixes an empty slot gets. A candidate clearly fits better
 * when the pick fits under that same line and the candidate fits over it (casting's fit-to-confidence rule): then
 * the default swaps to it; otherwise the clip stays. Pure, over the stored cast.
 */
import type { CastCandidate, SlotCast } from '@taalcut/core';
import { fitConfidence } from '../casting/alternates';
import { CASTING_CONFIG, type CastingConfig } from '../casting/config';

/** A shot as the gaps step offers it: which media, and how well it fits the slot's intent (0–1). */
export interface WeakShot {
  readonly assetId: CastCandidate['assetId'];
  readonly shotId: CastCandidate['shotId'];
  readonly fit: number;
  /** The scored candidate, for a swap that keeps its in-point. */
  readonly candidate: CastCandidate;
}

export interface WeakPick {
  readonly pick: WeakShot;
  readonly confidence: number;
  /** The next-best candidates, best fit first, at most the cast's alternates (three). */
  readonly candidates: readonly WeakShot[];
  /** The candidate that clearly fits better, when one does; the default swaps to it. */
  readonly better: WeakShot | null;
}

const shot = (candidate: CastCandidate): WeakShot => ({
  assetId: candidate.assetId,
  shotId: candidate.shotId,
  fit: Math.min(1, Math.max(0, candidate.parts.intent)),
  candidate,
});

/** Whether casting is unsure of the clip in this slot: a scored pick under the line (the person's own picks aren't). */
export function isWeakPick(slot: SlotCast, config: CastingConfig = CASTING_CONFIG): boolean {
  return (
    slot.clipId !== null &&
    slot.pick !== null &&
    slot.note !== 'userPick' &&
    slot.note !== 'gapFilled' &&
    slot.confidence !== null &&
    slot.confidence < config.confidence.rerankBelow
  );
}

/** The slot's weak pick with its swap candidates; null when the slot isn't a weak pick. */
export function weakPickOf(slot: SlotCast, config: CastingConfig = CASTING_CONFIG): WeakPick | null {
  if (!isWeakPick(slot, config) || !slot.pick || slot.confidence === null) return null;
  const pick = shot(slot.pick);
  const candidates = slot.alternates
    .map(shot)
    .sort((a, b) => b.fit - a.fit)
    .slice(0, config.confidence.alternates);
  const line = config.confidence.rerankBelow;
  const pickFits = fitConfidence(pick.fit, config) >= line;
  const better = pickFits
    ? null
    : (candidates.find((c) => c.fit > pick.fit && fitConfidence(c.fit, config) >= line) ?? null);
  return { pick, confidence: slot.confidence, candidates, better };
}
