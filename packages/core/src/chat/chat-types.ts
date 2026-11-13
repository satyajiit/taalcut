// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat surface's backend (P1-H3), as @taalcut/agent's createChatService
 * implements it and the renderer's chat client uses it: conversations, a
 * message sent as a run that streams core's `agent.*` events, stop (by
 * cancelling the stream, or by run id once the stream is gone), and answers to
 * approval and consent cards.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type ConversationId, type RunId, type TimelineCommentId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { messageExtrasShape, questionAnswerSchema, type ChatStart, type SelectionChip } from './chat-start';
import type { ChatEffort } from './effort';
import type { EditorContext } from '../timeline/edit-target';
import type { ReasoningLevel } from '../ports/model-ports';
import { agentEventSchema } from '../events/catalogue';
import { RUN_STATUSES } from '../ports/run-log';

const count = z.int().nonnegative();

/** The conversation list's rows. A conversation created by its first message has only the first four. */
export const conversationSummarySchema = z.object({
  id: idSchema<'Conversation'>(),
  /** Empty until the conversation has one. */
  title: z.string(),
  createdAt: count,
  updatedAt: count,
  projectId: idSchema<'Project'>().nullable().optional(),
  /** The start of the latest user or assistant text. */
  preview: z.string().optional(),
  archived: z.boolean().optional(),
});
export type ConversationSummary = z.output<typeof conversationSummarySchema>;

/** A message the user sent. In history only: live, the chat shows it from `send`'s first item. */
export const userMessageEventSchema = z.object({
  type: z.literal('user.message'),
  at: count,
  payload: z.object({
    messageId: idSchema<'Message'>(),
    conversationId: idSchema<'Conversation'>(),
    text: z.string(),
    ...messageExtrasShape,
  }),
});
export type UserMessageEvent = z.output<typeof userMessageEventSchema>;

/** What a run streams: core's `agent.*` events, from agent.runStarted to agent.runFinished. */
export type ChatEvent = z.output<typeof agentEventSchema>;

export const chatHistoryEventSchema = z.discriminatedUnion('type', [
  userMessageEventSchema,
  ...agentEventSchema.options,
]);
export type ChatHistoryEvent = ChatEvent | UserMessageEvent;

export const conversationRecordSchema = z.object({
  conversation: conversationSummarySchema,
  /** Everything said and done so far, oldest first: the renderer replays it through its live reducer. */
  history: z.array(chatHistoryEventSchema),
});

export interface ConversationRecord {
  readonly conversation: ConversationSummary;
  readonly history: readonly ChatHistoryEvent[];
}

export interface RunStream {
  readonly runId: RunId;
  /** The user's message as stored, so the transcript shows it with its id. */
  readonly userMessage: UserMessageEvent;
  /** From `agent.runStarted` to `agent.runFinished` (succeeded, failed, cancelled or paused). */
  readonly events: AsyncIterable<ChatEvent>;
}

export const approvalDecisionSchema = z.object({
  runId: idSchema<'AgentRun'>(),
  /** The `approvalId` of an `agent.approvalRequested` event, an approval, consent or costEstimate card. */
  approvalId: z.string().min(1).max(200),
  decision: z.enum(['approve', 'deny']),
  /** On an upload consent: "Always allow" for that cloud module, not just this once. */
  remember: z.boolean().optional(),
  /** On a skill's question (approval kind 'question'): the answer, e.g. how many variants. */
  answer: questionAnswerSchema.optional(),
});
export type ApprovalDecision = z.output<typeof approvalDecisionSchema>;

/** What `stop` answers: the run's status once stopped (`cancelled`, or how it had already ended). */
export const runStoppedSchema = z.object({ runId: idSchema<'AgentRun'>(), status: z.enum(RUN_STATUSES) });
export type RunStopped = z.output<typeof runStoppedSchema>;

export interface ChatService {
  listConversations(): AsyncResult<ConversationSummary[]>;
  /** An id never used is a new, empty conversation; it is stored with its first message. */
  getConversation(id: ConversationId): AsyncResult<ConversationRecord>;
  /** Stores the message, starts a run and streams it. Aborting `signal` stops the run. */
  send(
    input: {
      readonly conversationId: ConversationId;
      readonly text: string;
      /** How hard the agent thinks for this message. Absent: the model's own level (its profile's). */
      readonly effort?: ChatEffort;
      /** The exact level picked for this message (one of the model's). Replaces `effort` when both are set. */
      readonly reasoning?: ReasoningLevel;
      /** The opening card's choice: starts that flow. */
      readonly start?: ChatStart;
      /** What the user pointed at (V3). */
      readonly selections?: readonly SelectionChip[];
      /** EDT1: the editor as the user saw it, when the message is from its docked composer. */
      readonly editorContext?: EditorContext;
      /** EDT1-CMT: the comments the message hands to the agent ("Send N comments to Taalcut"). */
      readonly comments?: readonly TimelineCommentId[];
    },
    options: { readonly signal: AbortSignal },
  ): AsyncResult<RunStream>;
  /** Records the answer and continues the run; resolves when the run stops again. */
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

export const ChatServiceToken = createToken<ChatService>('core.chatService');
