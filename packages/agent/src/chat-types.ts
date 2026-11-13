// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the chat surface talks to (P1-H3): the shapes of
 * apps/renderer/src/chat/client.ts, so the oRPC contract can expose this
 * service as is. A run streams core's `agent.*` events, plus
 * `agent.reasoningDelta`, which core's catalogue doesn't have yet.
 */
import type {
  AsyncResult,
  ChatEffort,
  ChatStart,
  ConversationId,
  EditorContext,
  EventOf,
  EventType,
  MessageId,
  QuestionAnswer,
  RunId,
  RunStatus,
  ReasoningLevel,
  ReferencePointer,
  SelectionChip,
  TimelineCommentId,
} from '@taalcut/core';
import type { ConversationSummary } from './ports';

type CoreAgentEventType = Extract<EventType, `agent.${string}`>;

/** Reasoning text as it streams (requested from core as `agent.reasoningDelta`). */
export interface ReasoningDeltaEvent {
  readonly type: 'agent.reasoningDelta';
  readonly at: number;
  readonly payload: { readonly runId: RunId; readonly delta: string };
}

/** What a run streams: core's agent events, plus reasoning. */
export type ChatEvent = EventOf<CoreAgentEventType> | ReasoningDeltaEvent;

/** A message the user sent. In history only: live, the chat shows it from `send`'s answer. */
export interface UserMessageEvent {
  readonly type: 'user.message';
  readonly at: number;
  readonly payload: {
    readonly messageId: MessageId;
    readonly conversationId: ConversationId;
    readonly text: string;
    /** The opening card's choice this message started. */
    readonly start?: ChatStart;
    readonly selections?: SelectionChip[];
    /** P3-V15: what its words pointed at, as the run resolved them. */
    readonly pointers?: ReferencePointer[];
    /** EDT1-CMT: the comments it sent to Taalcut. */
    readonly comments?: TimelineCommentId[];
    /** EDT1: the editor as the user saw it, for a message from its docked chat. */
    readonly editorContext?: EditorContext;
  };
}

export type ChatHistoryEvent = ChatEvent | UserMessageEvent;

export interface ConversationRecord {
  readonly conversation: ConversationSummary;
  /** Everything said and done so far, oldest first: the renderer replays it through its live reducer. */
  readonly history: readonly ChatHistoryEvent[];
}

export interface RunStream {
  readonly runId: RunId;
  readonly userMessage: UserMessageEvent;
  /** From `agent.runStarted` to `agent.runFinished` (succeeded, failed, cancelled or paused). */
  readonly events: AsyncIterable<ChatEvent>;
}

export interface ApprovalDecision {
  readonly runId: RunId;
  /** The `approvalId` of an `agent.approvalRequested` event, or of a consent or costEstimate card. */
  readonly approvalId: string;
  readonly decision: 'approve' | 'deny';
  /** On an upload consent: "Always allow" for that cloud module, not just this once. */
  readonly remember?: boolean;
  /** On a skill's question: the answer (how many variants). */
  readonly answer?: QuestionAnswer;
}

/** What `stop` answers: the run's status once stopped (`cancelled`, or how it had already ended). */
export interface RunStopped {
  readonly runId: RunId;
  readonly status: RunStatus;
}

export interface ChatService {
  listConversations(): AsyncResult<ConversationSummary[]>;
  /** An id never used is a new, empty conversation; it is stored with its first message. */
  getConversation(id: ConversationId): AsyncResult<ConversationRecord>;
  /** Stores the message, starts a run and streams it. Aborting `signal` stops the run. */
  send(
    input: {
      readonly conversationId: ConversationId;
      readonly text: string;
      /** How hard the agent thinks for this message. Absent: the model's own level. */
      readonly effort?: ChatEffort;
      /** The exact level picked for this message (one of the model's). Replaces `effort` when both are set. */
      readonly reasoning?: ReasoningLevel;
      /** The opening card's choice: starts that flow. */
      readonly start?: ChatStart;
      /** What the user pointed at (V3). */
      readonly selections?: readonly SelectionChip[];
      /** EDT1-CMT: "Send N comments to Taalcut": the comments it hands to the run. */
      readonly comments?: readonly TimelineCommentId[];
      /** EDT1: the editor as the user saw it, from its docked composer. */
      readonly editorContext?: EditorContext;
    },
    options: { readonly signal: AbortSignal },
  ): AsyncResult<RunStream>;
  /**
   * Records the answer and continues the run. Resolves when the run stops
   * again (finished, or paused on its next question), so a history reload
   * right after shows the continuation; `follow` streams it live instead.
   */
  decideApproval(input: ApprovalDecision): AsyncResult<void>;
  /** A run's events from now until it next stops, e.g. after an approval. */
  follow(runId: RunId, options: { readonly signal: AbortSignal }): AsyncIterable<ChatEvent>;
  /**
   * Stops a run by id, for when its `send` stream is gone (after an answer, or
   * a reload): a live run is cancelled, a paused or interrupted one is marked
   * cancelled so it never resumes. Stopping an ended run changes nothing.
   */
  stop(runId: RunId): AsyncResult<RunStopped>;
}
