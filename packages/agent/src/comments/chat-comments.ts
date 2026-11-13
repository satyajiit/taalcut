// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT in the chat service: a message that sends comments reads the open ones into a batch before its run starts
 * (`open`; the run logs it in run.started). Following the agent's feed, a run that logs a batch marks it sent, and
 * when the run ends (succeeded, failed or cancelled; a paused run keeps them) the ones still sent go back to open. A
 * run resumed after a restart is found by its log. Without a port a message's comments are left out: it goes on as
 * words.
 */
import {
  ok,
  type AsyncResult,
  type CommentBatch,
  type CommentBatchPort,
  type RunId,
  type TimelineCommentId,
} from '@taalcut/core';
import type { Agent } from '../agent-types';
import { TERMINAL_EVENTS } from '../events';

export type { CommentBatchPort as ChatCommentsPort };

export interface ChatComments {
  /** The batch for a message's comments; undefined when there's no port or none is open. */
  open(ids: readonly TimelineCommentId[] | undefined): AsyncResult<CommentBatch | undefined>;
  /** Stops following the agent. */
  close(): void;
}

/** The ids a batch answers, for the user message (live and in the history). */
export const commentIds = (batch: CommentBatch | undefined): { comments?: TimelineCommentId[] } =>
  batch ? { comments: batch.comments.map((item) => item.commentId as TimelineCommentId) } : {};

export function createChatComments(
  port: CommentBatchPort | undefined,
  agent: Pick<Agent, 'events' | 'subscribe' | 'onFinalize'>,
): ChatComments {
  if (!port) return { open: async () => ok(undefined), close: () => {} };
  const batches = new Map<RunId, CommentBatch>();

  async function batchOf(runId: RunId): Promise<CommentBatch | undefined> {
    const known = batches.get(runId);
    if (known) return known;
    const log = await agent.events(runId);
    const first = log.ok ? log.value[0] : undefined;
    return first?.type === 'run.started' ? first.payload.comments : undefined;
  }

  async function sent(batch: CommentBatch, runId: RunId) {
    batches.set(runId, batch);
    const marked = await port!.send(batch, runId);
    if (!marked.ok) console.warn(`[comments] not marked sent: ${marked.error.code}`);
  }

  async function ended(runId: RunId) {
    const batch = await batchOf(runId);
    batches.delete(runId);
    if (!batch) return ok(undefined);
    const released = await port!.release(batch, runId);
    return released.ok ? ok(undefined) : released;
  }

  const unsubscribe = agent.subscribe((event) => {
    if (!('seq' in event)) return;
    if (event.type === 'run.started' && event.payload.comments)
      void sent(event.payload.comments, event.runId);
    else if (!agent.onFinalize && TERMINAL_EVENTS.includes(event.type)) void ended(event.runId);
  });

  const stopFinalizing = agent.onFinalize?.(ended);

  return {
    async open(ids) {
      if (!ids?.length) return ok(undefined);
      const batch = await port.open(ids);
      return batch.ok ? ok(batch.value ?? undefined) : batch;
    },
    close() {
      unsubscribe();
      stopFinalizing?.();
    },
  };
}
