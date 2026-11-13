// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: "Add more clips", the run's half. The owner added a clip while the run was going and nothing used it. When
 * the person's answer (on the card or in the chat) asks for their new clips, the step waits for the clips added since
 * the cast to be ready (the library's own import and indexing, from this Mac or the phone), casts the gaps that asked
 * again (GapClips.recast: one undo step), and builds the next round: what the new clips filled is settled, the rest is
 * asked again when it still matters. A gap answered "Add more clips" with no clips to wait for waits for footage.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { RunState } from '../run-state';
import type { GapAnswer } from './answers';
import type { GapOutcome, GapsJoinData } from './gap-card';
import type { AddedClips, GapClips, GapsDeps } from './gap-types';

/** After this many rounds the step stops waiting for clips: the gaps left wait for footage. */
export const MAX_ROUNDS = 4;
/** How long the step waits for added clips, and how often it looks (GapsDeps.clipWait overrides). */
export const CLIP_WAIT = { maxMs: 120_000, everyMs: 2_000 } as const;
/** With nothing added yet, it looks for this long only: the person may still be choosing the files. */
const NOTHING_YET_MS = 10_000;

/**
 * The person's answer to the step's latest round, if they gave one since it was logged (a round logged after the
 * answer makes it an answer to an earlier question).
 */
export function latestAnswer(state: RunState, stepId: string): readonly GapAnswer[] | undefined {
  const latest = state.extensions.findLast((e) => e.stepId === stepId);
  if (state.gapFixes === undefined) return undefined;
  if (latest?.seq === undefined || state.gapFixesAsked === undefined) return state.gapFixes;
  return state.gapFixesAsked > latest.seq ? state.gapFixes : undefined;
}

/** The gaps whose answer asks for the person's new clips. */
export function addClipsGaps(answer: readonly GapAnswer[] | undefined): string[] {
  return (answer ?? []).filter((a) => a.fix === 'addClips').map((a) => a.gapId);
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Waits until every clip added since `since` is ready, the wait is over, or the run stops; then how many are. */
export async function waitForClips(
  clips: GapClips,
  since: number,
  wait: GapsDeps['clipWait'],
  signal: AbortSignal,
  now: () => number = Date.now,
): AsyncResult<AddedClips> {
  const { maxMs, everyMs } = wait ?? CLIP_WAIT;
  const started = now();
  for (;;) {
    const seen = await clips.added(since, signal);
    if (!seen.ok) return seen;
    const { added, ready } = seen.value;
    const waited = now() - started;
    const enough = added > 0 ? ready >= added : waited >= Math.min(maxMs, NOTHING_YET_MS);
    if (enough || waited >= maxMs || signal.aborted) return ok(seen.value);
    await pause(everyMs, signal);
  }
}

/**
 * The gaps of the round before that the recast settled (they are no longer open), with how: an empty one filled, an
 * unsure one swapped. They stay on the card, folded.
 */
export function settledByRecast(
  before: GapsJoinData,
  stillOpen: ReadonlySet<string>,
): Map<string, { entry: GapsJoinData['gaps'][number]; outcome: GapOutcome }> {
  const settled = new Map<string, { entry: GapsJoinData['gaps'][number]; outcome: GapOutcome }>();
  for (const entry of before.gaps) {
    const gapId = entry.view.gapId;
    if (entry.settled) settled.set(gapId, { entry, outcome: entry.settled });
    else if (!stillOpen.has(gapId))
      settled.set(gapId, { entry, outcome: entry.row.state === 'weak' ? 'swapped' : 'filled' });
  }
  return settled;
}
