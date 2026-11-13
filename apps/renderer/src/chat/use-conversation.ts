// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ok,
  toTaalcutError,
  type ApprovalDecision,
  type AsyncResult,
  type ReasoningLevel,
  type ChatEvent,
  type ChatStart,
  type SelectionChip,
  type EditorContext,
  type ConversationId,
  type ConversationSummary,
  type Result,
  type RunId,
  type TaalcutError,
  type TimelineCommentId,
} from '@taalcut/core';
import { loadingTracker } from '@taalcut/ui';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useBackend, useEditorDrafts } from '../backend/backend';
import { usePlaySound } from '../features/sounds/interface-sounds';
import { prepareEditorSend } from './prepare-editor-send';
import { useConversationsRevision, useRunsResumed, useServices } from '../services/provider';
import { isFinal, pendingAsks, reducer, stoppableRuns } from './conversation-reducer';
import { addSelection, selectionKey, takeSelections } from './selection-store';
import { EMPTY_TRANSCRIPT, replay, RUN_FINISHED, type Transcript } from './transcript';
import type { Outgoing } from './transcript-view';
import { getPickedReasoning } from './use-agent-model';
import { useWatchPausedRun } from './use-watch-paused-run';
import { useConversationUpdates } from './use-conversation-updates';

export { pendingAsks, stoppableRuns } from './conversation-reducer';

export interface ConversationState {
  status: 'loading' | 'ready' | 'error';
  conversation: ConversationSummary | null;
  transcript: Transcript;
  /** Loading or sending failed: shown as an error card with a retry. */
  error: TaalcutError | null;
  /**
   * The message you sent until the conversation has it (UX round 1): shown at once, and kept, marked "Not sent",
   * when it didn't go.
   */
  outgoing: Outgoing | null;
  /** A run is going: the composer shows Stop. A run waiting for an answer doesn't count. */
  busy: boolean;
  /** How long the chat's last message asked Taalcut to think, if it picked a level. Kept with the runs. */
  reasoning: ReasoningLevel | undefined;
  /**
   * Sends a message; `reasoning` only when the chat picked a level (else the model's own). `extras`: an opening
   * choice's `start` (P2-M13) or selection chips.
   */
  send: (text: string, reasoning?: ReasoningLevel, extras?: MessageExtras) => void;
  /** Retries the last message that failed to send. */
  retrySend?: (() => void) | undefined;
  /**
   * Clears a transient send or stream error banner. A message that didn't go leaves the transcript: its chips go
   * back in the tray, and its words come back for the composer (returned, else null).
   */
  dismissError: () => string | null;
  /**
   * Answers an approval, consent or cost-estimate card and streams the run as
   * it carries on. Resolves once the run has picked up (or the answer failed),
   * not when it stops again.
   */
  answer: (decision: ApprovalDecision) => AsyncResult<void>;
  /**
   * Stops every run in progress or waiting for an answer, by id (chat.stop),
   * whether or not this page is streaming it; each run's final status lands in
   * the transcript.
   */
  stop: () => void;
  /** Stops one run that waits for an answer, by id (its paused line offers this). */
  stopRun: (runId: RunId) => void;
  reload: () => void;
}

/** What a message carries besides its words (core's messageExtrasShape). */
export interface MessageExtras {
  readonly start?: ChatStart;
  readonly selections?: readonly SelectionChip[];
  /** EDT1-CMT: the comments it sends to Taalcut. */
  readonly comments?: readonly TimelineCommentId[];
  /** EDT1: the editor as the user saw it, from the docked chat. */
  readonly editorContext?: EditorContext;
}

/** The chips once each, first first (the docked chat's selection may also have been added). */
function once(chips: readonly SelectionChip[]): SelectionChip[] {
  const seen = new Set<string>();
  return chips.filter((chip) => {
    const key = selectionKey(chip);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The stream being shown: a sent message's run, or a run followed after an answer. */
interface Live {
  readonly abort: AbortController;
  readonly following: boolean;
}

/** One conversation: its history, live runs, send, answers and stop. */
export function useConversation(id: ConversationId): ConversationState {
  const backend = useBackend();
  const playSound = usePlaySound();
  const drafts = useEditorDrafts();
  const { chat } = useServices();
  const [, conversationsChanged] = useConversationsRevision();
  const [resumed] = useRunsResumed();
  const [transcript, dispatch] = useReducer(reducer, EMPTY_TRANSCRIPT);
  const [status, setStatus] = useState<ConversationState['status']>('loading');
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [failedMessage, setFailedMessage] = useState<{
    text: string;
    reasoning?: ReasoningLevel;
    extras?: MessageExtras;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const outgoings = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const loadKey = useMemo(() => ({}), [chat, id, attempt, resumed]);
  const [readyKey, setReadyKey] = useState<object | null>(null);
  const live = useRef<Live | null>(null);
  const shown = useRef(transcript);
  useEffect(() => {
    shown.current = transcript;
  });

  useEffect(() => {
    let current = true;
    setStatus('loading');
    setError(null);
    setFailedMessage(null);
    setOutgoing(null);
    dispatch({ type: 'reset', transcript: EMPTY_TRANSCRIPT });
    void loadingTracker.track(chat.getConversation(id)).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setError(result.error);
        setStatus('error');
        return;
      }
      setConversation(result.value.conversation);
      dispatch({ type: 'reset', transcript: replay(result.value.history) });
      setReadyKey(loadKey);
      setStatus('ready');
    });
    return () => {
      current = false;
      live.current?.abort.abort();
      live.current = null;
    };
  }, [chat, id, attempt, resumed]);

  useConversationUpdates(chat, id, readyKey === loadKey, loadKey, (latest) => {
    setConversation(latest.conversation);
    dispatch({ type: 'saved-covers', history: latest.history });
  });

  const finish = useCallback(
    (run: Live) => {
      if (live.current !== run) return;
      live.current = null;
      // A sent run's stream that ends without saying how was stopped: record the cancel.
      if (!run.following) dispatch({ type: 'stopped', at: Date.now() });
      setSending(false);
      conversationsChanged();
    },
    [conversationsChanged],
  );

  /** Shows a run's events as they arrive. Calls `first` on the first one. */
  const play = useCallback(
    async (events: AsyncIterable<ChatEvent>, run: Live, first?: () => void) => {
      try {
        for await (const event of events) {
          if (live.current !== run) return;
          first?.();
          dispatch({ type: 'event', event });
        }
      } catch (cause) {
        if (!run.abort.signal.aborted) {
          const err = toTaalcutError(cause);
          if (shown.current.activeRunId) {
            dispatch({ type: 'failed', error: err, at: Date.now() });
          } else {
            setError(err);
          }
        }
      } finally {
        finish(run);
      }
    },
    [finish],
  );

  // A run waiting for an answer can carry on by itself (you changed what it made): follow it meanwhile.
  const watcher = useWatchPausedRun(chat, status === 'ready' && !sending ? transcript : null, (event) =>
    dispatch({ type: 'event', event }),
  );
  const start = useCallback(
    (following: boolean): Live => {
      watcher.stop();
      const run: Live = { abort: new AbortController(), following };
      live.current = run;
      setSending(true);
      setError(null);
      return run;
    },
    [watcher],
  );

  /** Answers "Not now" and shows the run's reply, then resolves once it has stopped again. */
  const decline = useCallback(
    async (decision: ApprovalDecision) => {
      const run = start(true);
      const followed = play(chat.follow(decision.runId, { signal: run.abort.signal }), run);
      const result = await chat.decideApproval(decision);
      // The run has stopped again (or the answer failed): its stream is over either way.
      if (live.current === run) run.abort.abort();
      await followed;
      if (!result.ok && result.error.code !== RUN_FINISHED) setError(result.error);
    },
    [chat, start, play],
  );

  const send = useCallback(
    (text: string, reasoning?: ReasoningLevel, extras?: MessageExtras) => {
      const trimmed = text.trim();
      if (!trimmed || live.current) return;
      const effectiveReasoning = reasoning ?? getPickedReasoning(backend) ?? shown.current.reasoning;
      const asks = pendingAsks(shown.current);
      // The chips in the composer go with the message (V3), and it shows at once, with them, where it will stay.
      const taken = takeSelections();
      const selections = once([...(extras?.selections ?? []), ...taken]);
      let editorContext = extras?.editorContext;
      outgoings.current += 1;
      const message: Outgoing = {
        key: `outgoing:${outgoings.current}`,
        text: trimmed,
        selections,
        failed: false,
      };
      setOutgoing(message);
      setFailedMessage(null);
      setError(null);
      void (async () => {
        for (const ask of asks) await decline(ask);
        if (live.current) {
          // Another run took the chat meanwhile (an answer you gave): the words and chips go back where they were.
          for (const chip of taken) addSelection(chip);
          setOutgoing(null);
          return;
        }
        const run = start(false);
        const prepared = await prepareEditorSend(backend, drafts, editorContext);
        if (prepared.ok) editorContext = prepared.value;
        const result = !prepared.ok
          ? prepared
          : await chat.send(
              {
                conversationId: id,
                text: trimmed,
                ...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
                ...(extras?.start ? { start: extras.start } : {}),
                ...(selections.length ? { selections } : {}),
                ...(extras?.comments?.length ? { comments: extras.comments } : {}),
                ...(editorContext ? { editorContext } : {}),
              },
              { signal: run.abort.signal },
            );
        if (!result.ok) {
          // It stays where you wrote it, marked "Not sent", with its chips; Try again sends it as it was.
          setOutgoing({ ...message, failed: true });
          setFailedMessage({
            text: trimmed,
            ...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
            extras: {
              ...(extras?.start ? { start: extras.start } : {}),
              selections,
              ...(extras?.comments ? { comments: extras.comments } : {}),
              ...(editorContext ? { editorContext } : {}),
            },
          });
          setError(result.error);
          finish(run);
          return;
        }
        setOutgoing(null);
        playSound('promptSent', 'message:' + result.value.userMessage.payload.messageId);
        dispatch({ type: 'event', event: result.value.userMessage });
        conversationsChanged();
        // A first message names the conversation: pick up its title.
        void chat.getConversation(id).then((latest) => {
          if (latest.ok && live.current === run) setConversation(latest.value.conversation);
        });
        await play(result.value.events, run);
      })();
    },
    [backend, drafts, chat, id, conversationsChanged, start, finish, play, decline, playSound],
  );
  const retrySend = useCallback(() => {
    if (!failedMessage) return;
    send(failedMessage.text, failedMessage.reasoning, failedMessage.extras);
  }, [failedMessage, send]);

  const dismissError = useCallback((): string | null => {
    setError(null);
    setFailedMessage(null);
    if (!failedMessage) return null;
    // The message leaves the transcript; what it carried goes back for you to send again.
    for (const chip of failedMessage.extras?.selections ?? []) addSelection(chip);
    setOutgoing(null);
    return failedMessage.text;
  }, [failedMessage]);

  const answerLive = useCallback(
    (decision: ApprovalDecision): AsyncResult<void> => {
      // Asked mid-stream: the stream already showing carries the rest of the run.
      if (live.current) return chat.decideApproval(decision);
      const run = start(true);
      return new Promise((resolve) => {
        let settled = false;
        const settle = (result: Result<void>) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        // Follow first, so nothing between the answer and the stream is missed.
        void play(chat.follow(decision.runId, { signal: run.abort.signal }), run, () =>
          settle(ok(undefined)),
        );
        // Resolves when the run stops again; the first followed event usually comes long before.
        void chat.decideApproval(decision).then((result) => {
          if (!result.ok || !settled) run.abort.abort();
          // It stopped again and the stream showed none of it: reload where it stands.
          if (result.ok && !settled) setAttempt((n) => n + 1);
          settle(result);
        });
      });
    },
    [chat, start, play],
  );

  const answer = useCallback(
    async (decision: ApprovalDecision): AsyncResult<void> => {
      const result = await answerLive(decision);
      if (!result.ok && result.error.code === RUN_FINISHED) {
        // It had ended (stopped elsewhere, or finished): stop says how, idempotently.
        const stopped = await chat.stop(decision.runId);
        const status = stopped.ok && isFinal(stopped.value.status) ? stopped.value.status : null;
        dispatch({ type: 'ended', runId: decision.runId, status, at: Date.now() });
      }
      return result;
    },
    [chat, answerLive],
  );

  const stopRun = useCallback(
    (runId: RunId) => {
      void chat.stop(runId).then((result) => {
        if (!result.ok) setError(result.error);
        else if (isFinal(result.value.status))
          dispatch({ type: 'finished', runId, status: result.value.status, at: Date.now() });
      });
    },
    [chat],
  );
  const stop = useCallback(() => {
    // A stream on screen ends at once (cancelling a sent message's stream stops its run too).
    live.current?.abort.abort();
    for (const runId of stoppableRuns(shown.current)) stopRun(runId);
  }, [stopRun]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    status,
    conversation,
    transcript,
    error,
    outgoing,
    busy: sending || transcript.activeRunId !== null,
    reasoning: transcript.reasoning,
    send,
    ...(failedMessage ? { retrySend } : {}),
    dismissError,
    answer,
    stop,
    stopRun,
    reload,
  };
}
