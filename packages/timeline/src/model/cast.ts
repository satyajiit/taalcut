// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Helpers for the cast state a timeline carries (core's castStateSchema). */
import type { AssetId, CastCandidate, CastState, Clip, RationalTime, ShotId, SlotCast } from '@taalcut/core';

/** One id per pickable thing: the shot, or the asset for a photo. */
export function candidateKey(candidate: { readonly assetId: string; readonly shotId: string | null }): string {
  return candidate.shotId ?? `asset:${candidate.assetId}`;
}

/** The shot a clip shows (the asset alone for a photo); null for audio. */
export function clipShot(clip: Clip): { readonly assetId: AssetId; readonly shotId: ShotId | null } | null {
  if (clip.media.kind === 'audio') return null;
  return { assetId: clip.media.assetId, shotId: clip.media.kind === 'video' ? clip.media.shotId : null };
}

/** The key of what a clip shows; null for audio. */
export function clipKey(clip: Clip): string | null {
  const shot = clipShot(clip);
  return shot ? candidateKey(shot) : null;
}

/** A pick the user (or the agent) made outside casting: it has no score. */
export function manualCandidate(
  media: Pick<CastCandidate, 'assetId' | 'shotId'>,
  sourceStart: RationalTime,
  syncPoint: RationalTime | null,
): CastCandidate {
  return {
    assetId: media.assetId,
    shotId: media.shotId,
    sourceStart,
    syncPoint,
    score: 0,
    parts: { intent: 0, motion: 0, quality: 0, subject: 0, energy: 0, hook: null, rerank: null, penalty: 0 },
  };
}

/** `m / (m + tau)` on the margin over the first alternate; 1 with no alternate (SPEC, step 6). */
export function marginConfidence(pick: number, firstAlternate: number | undefined, tau: number): number {
  if (firstAlternate === undefined) return 1;
  const margin = Math.max(0, pick - firstAlternate);
  return margin / (margin + tau);
}

/** The slot with a new pick: the old pick joins the alternates, the new one leaves them. */
export function withPick(
  slot: SlotCast,
  pick: CastCandidate,
  changes: Pick<SlotCast, 'confidence' | 'note' | 'needsRerank'>,
): SlotCast {
  const key = candidateKey(pick);
  const pool = [...(slot.pick ? [slot.pick] : []), ...slot.alternates];
  const alternates = pool.filter((candidate) => candidateKey(candidate) !== key).slice(0, 3);
  return { ...slot, pick, alternates, ...changes };
}

export function updateSlots(
  cast: CastState | null,
  update: (slot: SlotCast) => SlotCast,
): CastState | null {
  if (!cast) return null;
  return { ...cast, slots: cast.slots.map(update) };
}
