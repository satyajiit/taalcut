// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test support for learned casting preferences (LRN1-PREF): a scored candidate, and a person's swap as the command
 * bus writes it to a library's audit log, for tests that put swaps in a real library (the agent root's, the eval's
 * real-data reader).
 * Not part of the public API: tests import this file, and dependency-cruiser keeps it out of the app.
 */
import {
  FrameRates,
  newId,
  RationalTime,
  TIMELINE_COMMANDS,
  type CastCandidate,
  type CastingWeights,
  type CastState,
  type NewAuditEntry,
  type ProjectId,
  type SlotCast,
} from '@taalcut/core';
import { manualCandidate } from './model/cast';

const rate = FrameRates.fps30;

/** A new shot as casting scored it: `parts` are its five score parts, with no hook, rerank or penalty. */
export function scoredCandidate(parts: CastingWeights, score = 0.5): CastCandidate {
  const media = { assetId: newId<'Asset'>(), shotId: newId<'Shot'>() };
  return {
    ...manualCandidate(media, RationalTime.zero(rate), null),
    score,
    parts: { ...parts, hook: null, rerank: null, penalty: 0 },
  };
}

const shot = (motion: number, intent: number) =>
  scoredCandidate({ intent, motion, quality: 0.6, subject: 0.5, energy: 0.5 });

/**
 * A person's swap from the board's alternates, at `createdAt` in `projectId`: from a pick that matches the
 * description (intent 0.8, no camera motion) to the alternate whose camera motion matches the template (motion 1,
 * intent 0.35), with the score casting showed for it (`scored`) and the cast before the swap on its
 * `timeline.restore` inverse. Casting.v1's weights keep the pick, so only a learner that follows the swaps prefers
 * the alternate.
 */
export function personSwapEntry(projectId: ProjectId, createdAt: number): NewAuditEntry {
  const timelineId = newId<'Timeline'>();
  const chosen = shot(1, 0.35);
  const slot: SlotCast = {
    slotId: newId<'TemplateSlot'>(),
    clipId: newId<'TimelineItem'>(),
    pick: shot(0, 0.8),
    alternates: [chosen, shot(0.5, 0.4)],
    confidence: 0.4,
    needsRerank: false,
    note: null,
  };
  const cast: CastState = {
    castId: newId<'Cast'>(),
    mode: 'template',
    variantIndex: 0,
    variantCount: 1,
    configVersion: 'casting.v1',
    sequenceConfidence: 0.4,
    slots: [slot],
  };
  return {
    id: newId<'Command'>(),
    projectId,
    name: TIMELINE_COMMANDS.swapClip,
    payload: {
      projectId,
      timelineId,
      clipId: slot.clipId,
      media: { assetId: chosen.assetId, shotId: chosen.shotId },
      sourceStart: chosen.sourceStart,
      from: 'alternate',
      scored: { score: chosen.score, parts: chosen.parts },
    },
    inverse: { name: TIMELINE_COMMANDS.restore, payload: { projectId, timelineId, tracks: [], cast } },
    source: 'ui',
    actor: 'person',
    sideEffect: 'write',
    createdAt,
    idempotencyKey: null,
    result: { timelineId, revision: 2 },
  };
}
