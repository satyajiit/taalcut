// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where conversations are stored: the chat backend writes and reads them
 * (@taalcut/agent's createChatService takes a subset), and @taalcut/library
 * implements it (createLibraryPorts: `conversations`). `get` returns the
 * stored parts plus `history`, the events the renderer's transcript replays.
 */
import type { ConversationId, MessageId, ProjectId, RunId, ToolRunId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { ChatHistoryEvent } from '../chat/chat-types';
import type { SideEffect } from '../commands/definition';
import { createToken } from '../di/token';
import type { RunSummary } from './run-log';

export const CHAT_ROLES = ['user', 'assistant', 'system'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** A card payload (core's card protocol): at least an id and a type. Validated by the renderer with parseCard. */
export interface CardPayload {
  readonly id: string;
  readonly type: string;
  readonly [field: string]: unknown;
}

/** A stored message part. Cards are stored once per conversation and referred to by id. */
export type MessagePart =
  { readonly type: 'text'; readonly text: string } | { readonly type: 'card'; readonly cardId: string };

/** What appendMessage takes: a card may come whole (stored, then referred to) or as a reference. */
export type MessagePartInput =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'card'; readonly card: CardPayload }
  | { readonly type: 'card'; readonly cardId: string };

export interface StoredConversationSummary {
  readonly id: ConversationId;
  readonly projectId: ProjectId | null;
  /** Empty until the conversation has one. */
  readonly title: string;
  /** The start of the latest user or assistant text, or empty. */
  readonly preview: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived: boolean;
}

export interface ChatMessage {
  readonly id: MessageId;
  readonly role: ChatRole;
  readonly parts: readonly MessagePart[];
  /** The agent run that produced it, or that a user message started. */
  readonly runId: RunId | null;
  readonly createdAt: number;
}

export interface ChatCard {
  readonly cardId: string;
  readonly runId: RunId | null;
  /** The latest payload. */
  readonly card: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ChatToolRun {
  readonly id: ToolRunId;
  readonly runId: RunId | null;
  readonly messageId: MessageId | null;
  readonly tool: string;
  readonly sideEffect: SideEffect | null;
  readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly startedAt: number;
  readonly finishedAt: number | null;
  /** A TaalcutError, as stored (redacted). */
  readonly error: unknown;
}

/** What is stored for one conversation, oldest first. */
export interface ConversationHistory {
  readonly conversation: StoredConversationSummary;
  readonly messages: readonly ChatMessage[];
  readonly cards: readonly ChatCard[];
  readonly toolRuns: readonly ChatToolRun[];
  /** Agent runs linked to the conversation. */
  readonly runs: readonly RunSummary[];
}

/** `ConversationStore.get`: the stored parts and the history the transcript replays. */
export interface StoredConversation extends ConversationHistory {
  readonly history: readonly ChatHistoryEvent[];
}

export interface ConversationStore {
  create(input?: {
    id?: ConversationId;
    projectId?: ProjectId | null;
    title?: string | null;
  }): AsyncResult<StoredConversationSummary>;
  /** Most recent first, with title and a preview of the last message. Archived ones only with `archived: true`. */
  list(options?: {
    projectId?: ProjectId | null;
    archived?: boolean;
    limit?: number;
  }): AsyncResult<StoredConversationSummary[]>;
  /** core.not_found for an id never created. */
  get(id: ConversationId): AsyncResult<StoredConversation>;
  /** Creates the conversation on its first message. */
  appendMessage(input: {
    conversationId: ConversationId;
    role: ChatRole;
    parts: readonly MessagePartInput[];
    runId?: RunId | null;
    id?: MessageId;
  }): AsyncResult<ChatMessage>;
  /** Stores or updates a card the conversation shows (a plan, an approval, a tool run). */
  putCard(input: {
    conversationId: ConversationId;
    card: CardPayload;
    runId?: RunId | null;
  }): AsyncResult<ChatCard>;
  rename(
    id: ConversationId,
    title: string,
    options?: { preserveUpdatedAt?: boolean },
  ): AsyncResult<StoredConversationSummary>;
  /**
   * Moves the chat into a project (null: out of any), e.g. when its first flow creates one. A project that
   * doesn't exist is core.not_found.
   */
  setProject(id: ConversationId, projectId: ProjectId | null): AsyncResult<StoredConversationSummary>;
  archive(id: ConversationId): AsyncResult<StoredConversationSummary>;
  /** Undoes archive. */
  unarchive(id: ConversationId): AsyncResult<StoredConversationSummary>;
  /** Soft delete. */
  delete(id: ConversationId): AsyncResult<StoredConversationSummary>;
  /** Undoes delete. */
  restore(id: ConversationId): AsyncResult<StoredConversationSummary>;
  /** Removes a conversation and everything in it for good. */
  purge(id: ConversationId): AsyncResult<void>;
  linkRun(conversationId: ConversationId, runId: RunId): AsyncResult<void>;
}

export const ConversationStoreToken = createToken<ConversationStore>('core.conversationStore');
