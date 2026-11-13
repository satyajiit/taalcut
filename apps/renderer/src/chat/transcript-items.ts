// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Card, ChatStart, ReasoningLevel, ReferencePointer, RunId, SelectionChip } from '@taalcut/core';

/** What the chat shows, and the small pure helpers the transcript's folds share (transcript.ts, transcript-runs.ts). */

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';

export type TranscriptItem =
  | {
      kind: 'user';
      key: string;
      text: string;
      at: number;
      /** What the message pointed at (V3). */
      selections?: readonly SelectionChip[];
      /**
       * The opening choice it carried (P2-M13): a pasted reel's link is here, not in its words, so sending it again
       * (Try again on a message that didn't go) takes it along.
       */
      start?: ChatStart;
      /**
       * What its words pointed at (P3-V15: "the transition at 0:04"), as the agent resolved them: the stored
       * message's, or, live, the run's `agent.runStarted` (round P3-3).
       */
      pointers?: readonly ReferencePointer[];
    }
  | { kind: 'agent'; key: string; runId: RunId; text: string; streaming: boolean; at: number }
  | {
      kind: 'reasoning';
      key: string;
      runId: RunId;
      text: string;
      /** Current UI streaming segment after the latest phase transition; full text remains above. */
      currentText?: string;
      /** Display boundaries between UI streaming segments; each segment preserves the received deltas. */
      segments?: readonly string[];
      working: boolean;
      startedAt: number;
      endedAt?: number;
    }
  | {
      kind: 'card';
      key: string;
      card: Card;
      /** A tool call: the plan step that was running when it started, so the chat shows it under that step. */
      stepId?: string;
    }
  | { kind: 'unsupported'; key: string }
  | { kind: 'notice'; key: string; runId: RunId; notice: Notice };

/** A line under a run: it was stopped, it waits for an answer, it hit its budget, or it had ended. */
export type Notice = 'cancelled' | 'paused' | 'budget' | 'ended';

export interface Transcript {
  items: readonly TranscriptItem[];
  runs: Readonly<Record<string, RunStatus>>;
  /** The run in progress, if any: the composer shows Stop. */
  activeRunId: RunId | null;
  /** The thinking level the chat's last message asked for, if it picked one (agent.runStarted). */
  reasoning?: ReasoningLevel;
}

export const EMPTY_TRANSCRIPT: Transcript = { items: [], runs: {}, activeRunId: null };

export type Item<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

export function upsert(items: readonly TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const index = items.findIndex((existing) => existing.key === item.key);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

export function update<K extends TranscriptItem['kind']>(
  items: readonly TranscriptItem[],
  kind: K,
  match: (item: Item<K>) => boolean,
  change: (item: Item<K>) => Item<K>,
): TranscriptItem[] {
  return items.map((item) => (item.kind === kind && match(item as Item<K>) ? change(item as Item<K>) : item));
}

/** Thinking ends when the run starts doing or saying something else. */
export function endReasoning(items: readonly TranscriptItem[], runId: RunId, at: number): TranscriptItem[] {
  return update(
    items,
    'reasoning',
    (item) => item.runId === runId && item.working,
    (item) => ({ ...item, working: false, endedAt: at }),
  );
}
