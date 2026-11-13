// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RunMoodInput } from '@taalcut/ui';
import { asksNow } from './approvals';
import type { Transcript, TranscriptItem } from './transcript';

/**
 * The chat's newest run and where it stands, for Kaatu's mood. Runs are kept
 * in the order they started (an object keeps its keys' insertion order), so
 * the last one is the newest.
 */
export function latestRun(transcript: Transcript): RunMoodInput['latest'] {
  const ids = Object.keys(transcript.runs);
  const id = ids.at(-1);
  const phase = id === undefined ? undefined : transcript.runs[id];
  return id === undefined || phase === undefined ? null : { id, phase };
}

/**
 * The run already shows it is working: the agent's answer is streaming or its
 * "Thinking…" line is open. The working line then keeps Kaatu but drops its
 * words, so the same thing is never said twice.
 */
export function isTalking(items: readonly TranscriptItem[]): boolean {
  const last = items.at(-1);
  if (!last) return false;
  return (last.kind === 'agent' && last.streaming) || (last.kind === 'reasoning' && last.working);
}

/** The run's disclosure already carries the live thinking/working indicator. */
export function hasLiveActivity(transcript: Transcript): boolean {
  const run = latestRun(transcript);
  if (run?.phase !== 'running') return false;
  return transcript.items.some((item) =>
    item.kind === 'reasoning'
      ? item.runId === run.id
      : item.kind === 'card' &&
        (item.card.type === 'plan' ||
          item.card.type === 'toolRun' ||
          (item.card.type === 'costEstimate' &&
            item.card.version === 2 &&
            item.card.status !== 'asking' &&
            !asksNow(item.card))) &&
        item.card.runId === run.id,
  );
}
