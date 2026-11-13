// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gaps step's facts, built once per round from the stored timelines (SPEC section 26): every open gap of every
 * timeline with its card view (FIX-ASK: what it asks for made short, the closest clip, what it carries) and the row
 * the skill gets (the default fix), each timeline's counts, and why the run asks. A later round (after the person's
 * new clips were cast) keeps the gaps it settled, folded on the card and out of the skill's rows.
 */
import type { GapAskReason } from '@taalcut/core';
import { askReasons } from './ask-policy';
import type { GapOutcome, GapsJoinData } from './gap-card';
import { closestOf, shortWants, summaryOf } from './gap-facts';
import type { GapSlot, GapTimeline } from './gap-types';
import { chooseDefaults, gapRow, openSlots, proposeFixes, type ProposalInput } from './proposals';

/** A card holds at most this many gaps (core's gapFixCardSchema). */
const MAX_GAPS = 50;

export interface JoinRound {
  /** 1 when the step joins; one more after each Add more clips. */
  readonly round: number;
  /** Clips added after this time (ms) are the person's new ones. */
  readonly since: number;
  readonly newClips?: GapsJoinData['newClips'];
  /** Gaps of the round before that this round settled (the new clips filled them), by gap id. */
  readonly settled?: ReadonlyMap<
    string,
    { readonly entry: GapsJoinData['gaps'][number]; readonly outcome: GapOutcome }
  >;
}

function view(slot: GapSlot, proposal: ReturnType<typeof proposeFixes>) {
  const weak = slot.state === 'weak' ? slot.weak : undefined;
  const closest = closestOf(slot);
  return {
    gapId: slot.gapId,
    slotId: slot.slotId,
    number: slot.number,
    start: slot.start,
    duration: slot.duration,
    intent: slot.intent,
    note: slot.note,
    options: proposal.options,
    unavailable: proposal.unavailable,
    wants: shortWants(slot.intent?.text),
    closest: closest ? { ...closest, description: closest.description?.slice(0, 300) ?? null } : null,
    ...(slot.carries?.length ? { carries: [...new Set(slot.carries)] } : {}),
    ...(weak
      ? {
          weak: {
            pick: { ...weak.pick, description: weak.pick.description?.slice(0, 300) ?? null },
            confidence: weak.confidence,
            betterFit: weak.better !== null,
          },
        }
      : {}),
  };
}

/** The join data of one round, unchecked (the caller parses it against gapsJoinDataSchema). */
export function joinData(
  timelines: readonly GapTimeline[],
  input: ProposalInput,
  budgetLeft: number | null,
  round: JoinRound,
): Record<string, unknown> & { why: GapAskReason[] } {
  let left = budgetLeft;
  type Entry = {
    readonly view: { readonly number: number };
    readonly row: unknown;
    readonly settled?: GapOutcome;
  };
  const gaps: Entry[] = [];
  for (const timeline of timelines) {
    const rows = openSlots(timeline).map((slot) => ({ slot, proposal: proposeFixes(slot, timeline, input) }));
    const chosen = chooseDefaults(timeline, rows, { budgetLeftUsd: left });
    const open = new Set(rows.map((r) => r.slot.gapId));
    const own: Entry[] = [];
    for (const [gapId, { entry, outcome }] of round.settled ?? [])
      if (entry.row.timelineId === timeline.timelineId && !open.has(gapId))
        own.push({ ...entry, settled: outcome });
    for (const { slot, proposal } of rows) {
      const pick = chosen.get(slot.gapId) ?? { fix: 'film' as const, why: 'It waits for footage.' };
      if (pick.fix === 'generate' && left !== null && input.image.ok)
        left = Math.max(0, left - input.image.usdPerImage);
      own.push({ view: view(slot, proposal), row: gapRow(timeline.timelineId, slot, proposal, pick) });
    }
    gaps.push(...own.sort((a, b) => a.view.number - b.view.number));
  }
  return {
    timelines: timelines.map((t) => ({
      timelineId: t.timelineId,
      projectId: t.projectId,
      revision: t.revision,
      summary: summaryOf(t),
    })),
    gaps: gaps.slice(0, MAX_GAPS),
    round: round.round,
    since: round.since,
    ...(round.newClips ? { newClips: round.newClips } : {}),
    why: askReasons(timelines),
  };
}
