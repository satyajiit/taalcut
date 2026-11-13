// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting step 6: per slot, every candidate rescored with the chosen
 * neighbours fixed and the shots of other slots left out; the top three are
 * the alternates and the pick's margin over the first is its confidence.
 */
import type { CastCandidate, FrameRate } from '@taalcut/core';
import { marginConfidence } from '../model/cast';
import type { Sequence } from './beam';
import type { Candidate, SlotPool } from './candidates';
import type { CastingConfig } from './config';
import { selectInPoint } from './in-points';

export type Adjacency = (previous: Candidate, next: Candidate) => number;

export interface InContext {
  readonly candidate: Candidate;
  readonly score: number;
  readonly penalty: number;
}

export function inContext(
  candidate: Candidate,
  previous: Candidate | null,
  next: Candidate | null,
  adjacency: Adjacency,
): InContext {
  const penalty = (previous ? adjacency(previous, candidate) : 0) + (next ? adjacency(candidate, next) : 0);
  return { candidate, score: candidate.unary - penalty, penalty };
}

const byScore = (tie: number) => (a: InContext, b: InContext) =>
  Math.abs(a.score - b.score) > tie ? b.score - a.score : a.candidate.key < b.candidate.key ? -1 : 1;

/** The slot's candidates in context, best first, without shots used in other slots. */
export function ranked(
  pools: readonly SlotPool[],
  picks: readonly (Candidate | null)[],
  slot: number,
  adjacency: Adjacency,
  tie: number,
): InContext[] {
  const used = new Set(picks.flatMap((pick, index) => (pick && index !== slot ? [pick.key] : [])));
  const previous = slot > 0 ? (picks[slot - 1] ?? null) : null;
  const next = picks[slot + 1] ?? null;
  return (pools[slot]?.candidates ?? [])
    .filter((candidate) => !used.has(candidate.key))
    .map((candidate) => inContext(candidate, previous, next, adjacency))
    .sort(byScore(tie));
}

/** FIX-CAST: what the fit allows: 0 at or under `poorFit`, 1 from `goodFit`, a straight line between. */
export function fitConfidence(intent: number, config: CastingConfig): number {
  const { poorFit, goodFit } = config.confidence;
  if (intent >= goodFit) return 1;
  if (intent <= poorFit || goodFit <= poorFit) return 0;
  return (intent - poorFit) / (goodFit - poorFit);
}

/**
 * The cap a stored pick's fit puts on its confidence, for edits that place picks outside a cast (applyCast). A stored
 * pick keeps only its intent part, and a slot with no intent scores exactly the neutral value: no cap, as in
 * slotChoice.
 */
export function castingFitCap(config: CastingConfig): (pick: CastCandidate) => number {
  return (pick) =>
    pick.parts.intent === config.neutral.intent ? 1 : fitConfidence(pick.parts.intent, config);
}

export interface SlotChoice {
  readonly pick: InContext | null;
  readonly alternates: readonly InContext[];
  readonly confidence: number | null;
}

export function slotChoice(
  pools: readonly SlotPool[],
  sequence: Sequence,
  slot: number,
  adjacency: Adjacency,
  config: CastingConfig,
): SlotChoice {
  const chosen = sequence.picks[slot] ?? null;
  if (!chosen) return { pick: null, alternates: [], confidence: null };
  const all = ranked(pools, sequence.picks, slot, adjacency, config.tieEpsilon);
  const pick = all.find((entry) => entry.candidate.key === chosen.key) ?? null;
  const alternates = all
    .filter((entry) => entry.candidate.key !== chosen.key)
    .slice(0, config.confidence.alternates);
  if (!pick) return { pick: null, alternates, confidence: null };
  // FIX-CAST: no runner-up is no evidence. The margin counts only as far as the pick fits the slot's intent (a
  // slot without one has nothing to fit).
  let confidence = Math.min(
    marginConfidence(pick.score, alternates[0]?.score, config.confidence.tau),
    pick.candidate.cosine === null ? 1 : fitConfidence(pick.candidate.parts.intent, config),
  );
  const pool = pools[slot];
  if (pool?.relaxed && pick.candidate.profile.orientation !== pool.slot.orientation)
    confidence = Math.min(confidence, config.candidates.relaxedConfidenceCap);
  if (pool?.locked) confidence = 1;
  return { pick, alternates, confidence };
}

/** A scored candidate as the cast state stores it, with its in-point; null when the shot can't fill the slot. */
export function toCastCandidate(
  entry: InContext,
  pool: SlotPool,
  canvasRate: FrameRate,
  config: CastingConfig,
  fixed?: Pick<CastCandidate, 'sourceStart' | 'syncPoint'>,
): CastCandidate | null {
  const { candidate } = entry;
  const point =
    fixed ?? selectInPoint(candidate.profile, pool.slot, canvasRate, config, pool.slot.index === 0);
  if (!point) return null;
  return {
    assetId: candidate.profile.assetId,
    shotId: candidate.profile.shotId,
    sourceStart: point.sourceStart,
    syncPoint: point.syncPoint,
    score: entry.score,
    parts: {
      intent: candidate.parts.intent,
      motion: candidate.parts.motion,
      quality: candidate.parts.quality,
      subject: candidate.parts.subject,
      energy: candidate.parts.energy,
      hook: candidate.parts.hook,
      rerank: candidate.rerank,
      penalty: entry.penalty,
    },
  };
}
