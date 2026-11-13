// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Signals to pairs (SPEC, "Learned casting preferences"): one audit-log entry of a person overriding casting becomes
 * "chosen over rejected" pairs, each side with its five score parts as casting scored them at the time. Every edit's
 * inverse (`timeline.restore`) carries the cast as it was before the edit, picks and alternates with their parts, so
 * nothing is scored again from today's index.
 *
 * - `timeline.swapClip`: the shot swapped in over the pick it replaced; from the board's alternates, also over each
 *   other alternate it showed (weaker: seen, not picked). The shot's parts are the swap's `scored` (what the person
 *   was shown, from the cast or "Find something else"), else the stored alternate's.
 * - `timeline.dropSlot` of a clip casting chose: a weak negative, each pick of casting's the creator kept in that
 *   timeline over the removed one, sharing the removal's weight.
 *
 * Only a person's commands count (PERSON_SOURCES): the agent's and MCP's edits are casting's or a model's choices.
 */
import {
  castStateSchema,
  PERSON_SOURCES,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  type AuditEntry,
  type CastCandidate,
  type CastState,
  type SlotCast,
  CASTING_WEIGHT_KEYS,
} from '@taalcut/core';
import { z } from 'zod';
import { candidateKey } from '../../model/cast';
import type { LearnerConfig } from './learner-config';
import type { PreferencePair, ScoreParts } from './learner';

/** The commands whose entries become pairs. */
export const SIGNAL_COMMANDS: readonly string[] = [TIMELINE_COMMANDS.swapClip, TIMELINE_COMMANDS.dropSlot];

const PEOPLE: ReadonlySet<string> = new Set(PERSON_SOURCES);
/** Notes of a pick casting made (not a person's pick, a filled gap or a dropped slot). */
const CASTING_NOTES: ReadonlySet<SlotCast['note']> = new Set([null, 'reranked', 'orientationRelaxed']);

/** What a pair needs of a candidate. */
type Scored = Pick<CastCandidate, 'score' | 'parts'>;

/** The inverse's cast, read narrowly: the tracks it also carries are not the learner's. */
const restoredCast = z.object({ cast: castStateSchema.nullable().optional() });

/**
 * Whether casting scored this candidate. A pick made outside casting (`manualCandidate`: a search or agent swap
 * before LRN1-PREF, a filled gap) has no score: score 0 and every part 0.
 */
export function hasScore(candidate: Scored): boolean {
  return candidate.score !== 0 || CASTING_WEIGHT_KEYS.some((key) => candidate.parts[key] !== 0);
}

export function partsOf(candidate: Scored): ScoreParts {
  const { intent, motion, quality, subject, energy } = candidate.parts;
  return { intent, motion, quality, subject, energy };
}

/** The cast before the edit, from its `timeline.restore` inverse; null when the edit didn't change the cast. */
function castBefore(entry: AuditEntry): CastState | null {
  if (entry.inverse?.name !== TIMELINE_COMMANDS.restore) return null;
  const parsed = restoredCast.safeParse(entry.inverse.payload);
  return parsed.success ? (parsed.data.cast ?? null) : null;
}

const castingPick = (slot: SlotCast): CastCandidate | null =>
  slot.pick && hasScore(slot.pick) && CASTING_NOTES.has(slot.note) ? slot.pick : null;

function swapPairs(entry: AuditEntry, config: LearnerConfig): PreferencePair[] {
  const payload = timelineCommandPayloads[TIMELINE_COMMANDS.swapClip].safeParse(entry.payload);
  const cast = castBefore(entry);
  if (!payload.success || !cast) return [];
  const slot = cast.slots.find((candidate) => candidate.clipId === payload.data.clipId);
  if (!slot?.pick) return [];
  const key = candidateKey(payload.data.media);
  if (candidateKey(slot.pick) === key) return [];
  // The shot's parts as the person saw them (the swap's `scored`), else the stored alternate's.
  const chosen = payload.data.scored ?? slot.alternates.find((candidate) => candidateKey(candidate) === key);
  if (!chosen || !hasScore(chosen)) return [];
  const pairs: PreferencePair[] = [];
  const over = (rejected: Scored, weight: number) => {
    if (weight > 0 && hasScore(rejected))
      pairs.push({ chosen: partsOf(chosen), rejected: partsOf(rejected), weight });
  };
  over(slot.pick, config.pairWeight.replaced);
  if (payload.data.from === 'alternate')
    for (const other of slot.alternates)
      if (candidateKey(other) !== key) over(other, config.pairWeight.shown);
  return pairs;
}

function dropPairs(entry: AuditEntry, config: LearnerConfig): PreferencePair[] {
  const payload = timelineCommandPayloads[TIMELINE_COMMANDS.dropSlot].safeParse(entry.payload);
  const cast = castBefore(entry);
  if (!payload.success || !cast || config.pairWeight.removal === 0) return [];
  const dropped = cast.slots.find((slot) => slot.clipId === payload.data.itemId);
  const removed = dropped ? castingPick(dropped) : null;
  if (!dropped || !removed) return [];
  const kept = cast.slots.flatMap((slot) => {
    const pick = slot === dropped || slot.clipId === null ? null : castingPick(slot);
    return pick ? [pick] : [];
  });
  const weight = config.pairWeight.removal / Math.max(1, kept.length);
  return kept.map((pick) => ({ chosen: partsOf(pick), rejected: partsOf(removed), weight }));
}

/** The pairs one entry gives: none unless it is a person's, still applied, swap or removal. */
export function signalPairs(entry: AuditEntry, config: LearnerConfig): PreferencePair[] {
  if (entry.undone || !PEOPLE.has(entry.source)) return [];
  if (entry.name === TIMELINE_COMMANDS.swapClip) return swapPairs(entry, config);
  if (entry.name === TIMELINE_COMMANDS.dropSlot) return dropPairs(entry, config);
  return [];
}
