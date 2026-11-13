// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ChatEvent, ChatService, RunId } from '@taalcut/core';
import { useEffect, useMemo, useRef } from 'react';
import type { Transcript } from './transcript';

/** The cards a flow pauses on: a change you make while one waits carries the run on by itself. */
const FLOW_PAUSES = new Set(['exportApproval', 'budgetCap']);

/**
 * The run a chat should keep an ear on: one running without a stream on screen, else the newest run paused
 * on a flow's approval. Other paused runs (a consent, a tool's approval) wait for this window's answer; if
 * another window ends one, the answer here gets the calm "already ended" note.
 */
export function runToWatch(transcript: Transcript): RunId | null {
  if (transcript.activeRunId) return transcript.activeRunId;
  const flowRuns = new Set(
    transcript.items.flatMap((item) =>
      item.kind === 'card' && FLOW_PAUSES.has(item.card.type) && 'runId' in item.card
        ? [item.card.runId]
        : [],
    ),
  );
  const paused = Object.entries(transcript.runs).filter(
    ([runId, status]) => status === 'paused' && flowRuns.has(runId as RunId),
  );
  return (paused.at(-1)?.[0] as RunId | undefined) ?? null;
}

/**
 * Follows a run that waits for an answer, while nothing else streams in this
 * chat (P2-M13: the agent doesn't wait). When you change something its flow
 * made, the run carries on by itself (the export card goes back to
 * "updating", the video is checked again, the approval comes back): those
 * events arrive here. `transcript` is null while the chat streams a run of its
 * own or isn't ready, which stops the watch; `stop()` stops it at once.
 */
export function useWatchPausedRun(
  chat: Pick<ChatService, 'follow'>,
  transcript: Transcript | null,
  onEvent: (event: ChatEvent) => void,
): { stop(): void } {
  const target = transcript ? runToWatch(transcript) : null;
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!target) return;
    const abort = new AbortController();
    current.current = abort;
    void (async () => {
      // Each follow lasts until the run next stops; it may pause again and carry on again, so listen again.
      while (!abort.signal.aborted) {
        try {
          for await (const event of chat.follow(target, { signal: abort.signal })) {
            if (abort.signal.aborted) return;
            handler.current(event);
          }
        } catch {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();
    return () => {
      abort.abort();
      if (current.current === abort) current.current = null;
    };
  }, [chat, target]);

  return useMemo(() => ({ stop: () => current.current?.abort() }), []);
}
