// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting's placement fallback (FRM1-OVL, plan "ovl" 3.3): a slot whose clip leaves an overlay no room, even
 * shrunk and retimed, takes its next-best alternate that has room, in casting's order. Only alternates whose
 * people are known (a subject span) are tried: one of unknown room could cover a head as easily. A locked clip or
 * the person's own pick is never recast. The swap is applyCast's, so the cast's pick, alternates and confidence
 * move as a swap moves them. Pure.
 */
import { type CastCandidate, type MediaRef, type SubjectSpan } from '@taalcut/core';
import {
  clipUnder,
  itemsOver,
  mends,
  merged,
  needsFallback,
  stillFailing,
  withReason,
} from '../assembly/placement/fallbacks';
import { placeOverlays, type PlaceInput, type PlaceResult } from '../assembly/placement/place-timeline';
import { applyCast } from '../edits/swap';
import { candidateKey } from '../model/cast';

/** The key a candidate's subject span is held under: its shot and in-point. */
export const alternateKey = (candidate: Pick<CastCandidate, 'assetId' | 'shotId' | 'sourceStart'>) =>
  `${candidateKey(candidate)}@${candidate.sourceStart.value}/${candidate.sourceStart.rate.num}`;

export interface RecastInput extends PlaceInput {
  readonly result: PlaceResult;
  /** Subject spans of the alternates, by alternateKey; an alternate without one isn't tried. */
  readonly alternates: ReadonlyMap<string, SubjectSpan | undefined>;
  /** Media of the alternates, by candidate key. */
  readonly media: ReadonlyMap<string, MediaRef>;
  /** casting's `confidence.tau`. */
  readonly tau: number;
}

/** The alternates worth trying for each noRoom or side-lost item's slot: casting's order, people known. */
export function recastCandidates(
  input: Pick<RecastInput, 'result'>,
): { slotId: string; alternates: CastCandidate[] }[] {
  const { timeline, report } = input.result;
  const out: { slotId: string; alternates: CastCandidate[] }[] = [];
  for (const failed of report.filter(needsFallback)) {
    const placed = clipUnder(timeline, failed.span);
    const slot = timeline.cast?.slots.find((entry) => entry.slotId === placed?.clip.slotId);
    if (!placed || !slot || placed.clip.locked || slot.note === 'userPick') continue;
    if (!out.some((entry) => entry.slotId === slot.slotId))
      out.push({ slotId: slot.slotId, alternates: [...slot.alternates] });
  }
  return out;
}

export function recastForRoom(input: RecastInput): PlaceResult {
  let { timeline, report } = input.result;
  const subjects = new Map(input.subjects);
  for (const first of input.result.report.filter(needsFallback)) {
    const failed = stillFailing(report, first.id);
    if (!failed) continue;
    const placed = clipUnder(timeline, failed.span);
    const slot = timeline.cast?.slots.find((entry) => entry.slotId === placed?.clip.slotId);
    if (!placed || !slot || placed.clip.locked || slot.note === 'userPick') continue;
    const affected = itemsOver(report, placed);
    for (const alternate of slot.alternates) {
      const span = input.alternates.get(alternateKey(alternate));
      if (!span || !input.media.has(candidateKey(alternate))) continue;
      const swapped = applyCast(timeline, [{ slotId: slot.slotId, pick: alternate }], {
        source: 'agent',
        media: input.media,
        tau: input.tau,
      });
      if (!swapped.ok) continue;
      const tried = placeOverlays({
        ...input,
        timeline: swapped.value.timeline,
        subjects: new Map(subjects).set(placed.clip.id, span),
        only: affected,
      });
      if (!mends(failed, report, tried.report)) continue;
      subjects.set(placed.clip.id, span);
      timeline = withReason(tried.timeline, failed.id, 'recast');
      report = merged(report, tried.report, failed.id, 'recast');
      break;
    }
  }
  return { timeline, report };
}
