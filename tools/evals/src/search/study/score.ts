// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The study's scoring: a hit is relevant when it is a labelled asset and, for a labelled moment, its shot
 * overlaps the moment by at least half of the shorter of the two (the search eval's shot-matching rule, in
 * seconds). Per probe: the rank of the first relevant hit. Per group: hit@1, hit@5 and the mean reciprocal rank
 * over the hits returned (a probe with no relevant hit adds 0).
 */
import type { StudyLabel } from './labels';
import type { StudyShot } from './stored-library';

/** Hits each probe asks for: deep enough for reciprocal rank past the top 5. */
export const STUDY_LIMIT = 20;

export function shotMatches(label: StudyLabel, shot: StudyShot): boolean {
  if (label.asset !== shot.asset) return false;
  if (!label.range) return true;
  const overlap = Math.min(label.range.to, shot.to) - Math.max(label.range.from, shot.from);
  const shorter = Math.min(label.range.to - label.range.from, shot.to - shot.from);
  return overlap > 0 && shorter > 0 && overlap / shorter >= 0.5;
}

/** 1-based rank of the first relevant shot, or null. */
export function firstRelevantRank(
  relevant: readonly StudyLabel[],
  shots: readonly StudyShot[],
): number | null {
  const index = shots.findIndex((shot) => relevant.some((label) => shotMatches(label, shot)));
  return index < 0 ? null : index + 1;
}

export interface RankScore {
  readonly probes: number;
  readonly hitAt1: number;
  readonly hitAt5: number;
  readonly mrr: number;
}

export function scoreRanks(ranks: readonly (number | null)[]): RankScore {
  const n = ranks.length;
  if (n === 0) return { probes: 0, hitAt1: 0, hitAt5: 0, mrr: 0 };
  const share = (test: (rank: number) => boolean) => ranks.filter((r) => r !== null && test(r)).length / n;
  return {
    probes: n,
    hitAt1: share((r) => r === 1),
    hitAt5: share((r) => r <= 5),
    mrr: ranks.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0) / n,
  };
}
