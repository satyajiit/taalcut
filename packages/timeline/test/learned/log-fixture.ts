// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audit-log entries as the bus writes them, for the learner's tests: swaps and removals whose `timeline.restore`
 * inverse carries the cast before the edit, and memory commands on the learned item.
 */
import {
  FrameRates,
  MEMORY_COMMANDS,
  newId,
  RationalTime,
  TIMELINE_COMMANDS,
  type AuditEntry,
  type CastCandidate,
  type CastState,
  type CommandSource,
  type MemoryId,
  type ProjectId,
  type SlotCast,
  type CastingWeights,
} from '@taalcut/core';
import { CASTING_CONFIG } from '../../src/casting/config';
import { manualCandidate } from '../../src/model/cast';
import type { ScoreParts } from '../../src/casting/learned/learner';

const rate = FrameRates.fps30;

export const unscored = (): CastCandidate =>
  manualCandidate({ assetId: newId<'Asset'>(), shotId: newId<'Shot'>() }, RationalTime.zero(rate), null);

export function slot(
  pick: CastCandidate | null,
  alternates: CastCandidate[],
  note: SlotCast['note'] = null,
): SlotCast {
  return {
    slotId: newId<'TemplateSlot'>(),
    clipId: newId<'TimelineItem'>(),
    pick,
    alternates,
    confidence: 0.5,
    needsRerank: false,
    note,
  };
}

export function cast(slots: SlotCast[]): CastState {
  return {
    castId: newId<'Cast'>(),
    mode: 'template',
    variantIndex: 0,
    variantCount: 1,
    configVersion: 'casting.v5',
    sequenceConfidence: 0.5,
    slots,
  };
}

export interface LogClock {
  at: number;
  sequence: number;
}

export function clock(): LogClock {
  return { at: 1_000, sequence: 0 };
}

interface EntryOptions {
  readonly source?: CommandSource;
  readonly actor?: string;
  readonly undone?: boolean;
  readonly projectId?: ProjectId | null;
}

function entry(
  time: LogClock,
  name: string,
  payload: unknown,
  inverse: AuditEntry['inverse'],
  options: EntryOptions = {},
): AuditEntry {
  time.at += 10;
  time.sequence += 1;
  return {
    id: newId<'Command'>(),
    projectId: options.projectId === undefined ? null : options.projectId,
    name,
    payload,
    inverse,
    source: options.source ?? 'ui',
    actor: options.actor ?? 'person',
    sideEffect: 'write',
    createdAt: time.at,
    idempotencyKey: null,
    result: null,
    sequence: time.sequence,
    undone: options.undone ?? false,
  };
}

const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };

/** An edit of one timeline whose `timeline.restore` inverse carries the cast as it was before. */
function castEdit(time: LogClock, name: string, change: object, before: CastState, options: EntryOptions) {
  const inverse = { name: TIMELINE_COMMANDS.restore, payload: { ...target, tracks: [], cast: before } };
  return entry(time, name, { ...target, ...change }, inverse, { projectId: target.projectId, ...options });
}

interface SwapOptions extends EntryOptions {
  readonly from?: 'alternate' | 'search' | 'agent';
}

/** A person's swap of `at`'s clip to `to` (from the alternates unless `from` says otherwise). */
export function swapEntry(
  time: LogClock,
  before: CastState,
  at: SlotCast,
  to: CastCandidate,
  { from = 'alternate', ...options }: SwapOptions = {},
): AuditEntry {
  const media = { assetId: to.assetId, shotId: to.shotId };
  const change = { clipId: at.clipId, media, sourceStart: to.sourceStart, from };
  return castEdit(time, TIMELINE_COMMANDS.swapClip, change, before, options);
}

/** A person's removal of `at`'s clip (ripple). */
export function dropEntry(time: LogClock, before: CastState, at: SlotCast, options: EntryOptions = {}) {
  return castEdit(time, TIMELINE_COMMANDS.dropSlot, { itemId: at.clipId, mode: 'ripple' }, before, options);
}

export const LEARNER = { source: 'agent', actor: 'casting:learner' } as const;

export function weightsData(weights: CastingWeights, pairs = 12) {
  return {
    kind: 'casting-weights' as const,
    configVersion: 'casting.v5',
    defaults: CASTING_CONFIG.weights,
    weights,
    pairs,
  };
}

export function createEntry(
  time: LogClock,
  memoryId: MemoryId,
  weights: CastingWeights,
  options: EntryOptions = LEARNER,
) {
  const item = { scope: { kind: 'user' }, text: 'Leans.', source: 'learned', data: weightsData(weights) };
  return entry(time, MEMORY_COMMANDS.create, { projectId: null, memoryId, item }, null, options);
}

export function updateEntry(
  time: LogClock,
  memoryId: MemoryId,
  weights: CastingWeights,
  options: EntryOptions = {},
) {
  const payload = {
    projectId: null,
    memoryId,
    baseRevision: 1,
    patch: { text: 'Leans.', data: weightsData(weights) },
  };
  return entry(time, MEMORY_COMMANDS.update, payload, null, options);
}

export function deleteEntry(time: LogClock, memoryId: MemoryId, options: EntryOptions = {}) {
  return entry(time, MEMORY_COMMANDS.remove, { projectId: null, memoryId }, null, options);
}

/** Parts that differ only where named, from a middling shot. */
export function parts(over: Partial<ScoreParts> = {}): ScoreParts {
  return { intent: 0.5, motion: 0.5, quality: 0.5, subject: 0.5, energy: 0.5, ...over };
}
