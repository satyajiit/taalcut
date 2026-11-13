// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Chat persistence for the chat backend (synchronous; ports/conversations.ts
 * is the async port). Conversations are archived and deleted softly, so both
 * can be undone; purge removes one for good. Message text, card payloads and
 * titles are redacted of secrets before they are written (P1-F5).
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type ConversationId,
  type MessageId,
  type ProjectId,
  type Result,
  type RunId,
} from '@taalcut/core';
import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type {
  ChatCard,
  ChatMessage,
  ChatRole,
  ConversationHistory,
  ConversationSummary,
  MessagePart,
  MessagePartInput,
} from '../chat/types';
import { CHAT_ROLES } from '../chat/types';
import type { LibraryDatabase } from '../db/database';
import { InvalidState } from '../errors';
import { agentRuns } from '../schema/audit';
import { chatCards, conversations, messages, projects, toolRuns } from '../schema/chat';
import { redactSecrets, redactText } from '../secrets/redact';
import { createConversationRepository } from './projects';
import { attemptWrite, inTransaction, pageSize } from './shared';

type ConversationRow = typeof conversations.$inferSelect;

export interface ChatRepository {
  create(input?: {
    id?: ConversationId;
    projectId?: ProjectId | null;
    title?: string | null;
  }): Result<ConversationSummary>;
  /** Most recently updated first; deleted ones never, archived ones only with `archived: true`. */
  list(options?: { projectId?: ProjectId | null; archived?: boolean; limit?: number }): ConversationSummary[];
  /** Everything stored for a conversation, oldest first. Deleted conversations are core.not_found. */
  history(id: ConversationId): Result<ConversationHistory>;
  /** Appends a message, creating the conversation on its first one. Whole cards in `parts` are stored and referred to. */
  appendMessage(input: {
    conversationId: ConversationId;
    role: ChatRole;
    parts: readonly MessagePartInput[];
    runId?: RunId | null;
    id?: MessageId;
  }): Result<ChatMessage>;
  /** Stores a card's latest payload (cards update in place by id). */
  putCard(input: {
    conversationId: ConversationId;
    card: MessagePartCard;
    runId?: RunId | null;
  }): Result<ChatCard>;
  rename(
    id: ConversationId,
    title: string,
    options?: { preserveUpdatedAt?: boolean },
  ): Result<ConversationSummary>;
  /** Moves the conversation into a project, or out of any with null; an unknown project is core.not_found. */
  setProject(id: ConversationId, projectId: ProjectId | null): Result<ConversationSummary>;
  archive(id: ConversationId): Result<ConversationSummary>;
  unarchive(id: ConversationId): Result<ConversationSummary>;
  /** Soft delete; `restore` undoes it. */
  remove(id: ConversationId): Result<ConversationSummary>;
  restore(id: ConversationId): Result<ConversationSummary>;
  /** Deletes the conversation with its messages, cards and tool runs, for good. */
  purge(id: ConversationId): Result<void>;
  /** Links an agent run to the conversation, creating its run summary if the run hasn't logged yet. */
  linkRun(conversationId: ConversationId, runId: RunId): Result<void>;
}

type MessagePartCard = Extract<MessagePartInput, { card: unknown }>['card'];

const MAX_TITLE = 200;
const MAX_PREVIEW = 120;

const cardSchema = z.looseObject({ id: z.string().min(1).max(200), type: z.string().min(1) });
const partSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('card'), card: cardSchema }),
  z.object({ type: z.literal('card'), cardId: z.string().min(1).max(200) }),
]);

function invalid(field: string, error: z.ZodError) {
  const path = error.issues[0]?.path.map(String).join('.');
  return err(ValidationError({ field: path ? `${field}.${path}` : field }, { detail: error.message }));
}

/** Stored content as parts; tolerant of older shapes (a plain string, or anything else). */
export function partsOf(content: unknown): MessagePart[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown): MessagePart[] => {
    const p = part as { type?: unknown; text?: unknown; cardId?: unknown } | null;
    if (p?.type === 'text' && typeof p.text === 'string') return [{ type: 'text', text: p.text }];
    if (p?.type === 'card' && typeof p.cardId === 'string') return [{ type: 'card', cardId: p.cardId }];
    return [];
  });
}

function previewOf(content: string | null): string {
  if (!content) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return '';
  }
  const text = partsOf(parsed).find((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text');
  const flat = text?.text.replace(/\s+/g, ' ').trim() ?? '';
  return flat.length > MAX_PREVIEW ? `${flat.slice(0, MAX_PREVIEW - 1)}…` : flat;
}

export function createChatRepository(db: LibraryDatabase): ChatRepository {
  const { orm } = db;
  const base = createConversationRepository(db);
  // Spelled out: Drizzle renders a column of a single-table select unqualified, which would bind to m.id here.
  const latestText = sql<string | null>`(SELECT m.content FROM messages m
    WHERE m.conversation_id = "conversations"."id" AND m.role IN ('user', 'assistant')
    ORDER BY m.id DESC LIMIT 1)`;
  const select = () =>
    orm.select({ ...getTableColumns(conversations), latest: latestText }).from(conversations);
  const toSummary = (row: ConversationRow & { latest: string | null }): ConversationSummary => ({
    id: row.id,
    projectId: row.projectId,
    title: row.title ?? '',
    preview: previewOf(row.latest),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archived: row.archivedAt !== null,
  });
  const summary = (id: ConversationId) => select().where(eq(conversations.id, id)).get();

  /** The conversation, if it exists and isn't deleted (unless `deleted` is allowed). */
  function live(id: ConversationId, allowDeleted = false): Result<ConversationRow> {
    const row = orm.select().from(conversations).where(eq(conversations.id, id)).get();
    if (!row) return err(NotFoundError({ entity: 'conversation', id }));
    if (row.deletedAt !== null && !allowDeleted) {
      return err(InvalidState({ entity: 'conversation', state: 'deleted' }));
    }
    return ok(row);
  }

  function change(
    id: ConversationId,
    set: Partial<ConversationRow>,
    allowDeleted = false,
  ): Result<ConversationSummary> {
    return inTransaction(db, 'conversation', () => {
      const current = live(id, allowDeleted);
      if (!current.ok) return current;
      orm.update(conversations).set(set).where(eq(conversations.id, id)).run();
      return ok(toSummary(summary(id)!));
    });
  }

  function storeCard(conversationId: ConversationId, card: MessagePartCard, runId: RunId | null): ChatCard {
    const now = db.clock();
    const payload = redactSecrets(card);
    const row = orm
      .insert(chatCards)
      .values({ conversationId, cardId: card.id, runId, card: payload, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [chatCards.conversationId, chatCards.cardId],
        set: { card: payload, updatedAt: now, runId: sql`coalesce(${runId}, ${chatCards.runId})` },
      })
      .returning()
      .get();
    orm.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId)).run();
    return {
      cardId: row.cardId,
      runId: row.runId,
      card: row.card,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    create(input = {}) {
      const title = input.title == null ? null : redactText(input.title.trim()).slice(0, MAX_TITLE);
      const created = base.create({ ...input, title });
      return created.ok ? ok(toSummary(summary(created.value.id)!)) : created;
    },

    list(options = {}) {
      const project =
        options.projectId === undefined
          ? undefined
          : options.projectId === null
            ? isNull(conversations.projectId)
            : eq(conversations.projectId, options.projectId);
      return select()
        .where(
          and(
            isNull(conversations.deletedAt),
            options.archived ? isNotNull(conversations.archivedAt) : isNull(conversations.archivedAt),
            project,
          ),
        )
        .orderBy(desc(conversations.updatedAt), desc(conversations.id))
        .limit(pageSize(options.limit, 100, 1000))
        .all()
        .map(toSummary);
    },

    history(id) {
      const row = summary(id);
      if (!row || row.deletedAt !== null) return err(NotFoundError({ entity: 'conversation', id }));
      const stored = orm
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, id), ne(messages.role, 'tool')))
        .orderBy(asc(messages.id))
        .all();
      const cards = orm
        .select()
        .from(chatCards)
        .where(eq(chatCards.conversationId, id))
        .orderBy(asc(chatCards.createdAt), asc(chatCards.cardId))
        .all();
      const tools = orm
        .select()
        .from(toolRuns)
        .where(eq(toolRuns.conversationId, id))
        .orderBy(asc(toolRuns.startedAt), asc(toolRuns.id))
        .all();
      return ok({
        conversation: toSummary(row),
        messages: stored.map((m) => ({
          id: m.id,
          role: m.role as ChatRole,
          parts: partsOf(m.content),
          runId: m.runId,
          createdAt: m.createdAt,
        })),
        cards: cards.map(({ conversationId: _, ...card }) => card),
        toolRuns: tools.map((t) => ({
          id: t.id,
          runId: t.runId,
          messageId: t.messageId,
          tool: t.toolName,
          sideEffect: t.sideEffect,
          status: t.status,
          startedAt: t.startedAt,
          finishedAt: t.finishedAt,
          error: t.error,
        })),
        runs: orm
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.conversationId, id))
          .orderBy(asc(agentRuns.startedAt), asc(agentRuns.runId))
          .all(),
      });
    },

    appendMessage(input) {
      if (!CHAT_ROLES.includes(input.role)) return err(ValidationError({ field: 'role' }));
      const parsed = z.array(partSchema).safeParse(input.parts);
      if (!parsed.success) return invalid('parts', parsed.error);
      return inTransaction(db, 'message', () => {
        const existing = orm
          .select()
          .from(conversations)
          .where(eq(conversations.id, input.conversationId))
          .get();
        if (!existing) {
          const created = base.create({ id: input.conversationId });
          if (!created.ok) return created;
        } else if (existing.deletedAt !== null) {
          return err(InvalidState({ entity: 'conversation', state: 'deleted' }));
        }
        const parts: MessagePart[] = [];
        for (const part of parsed.data) {
          if (part.type === 'text') parts.push(part);
          else if ('card' in part) {
            parts.push({
              type: 'card',
              cardId: storeCard(input.conversationId, part.card, input.runId ?? null).cardId,
            });
          } else {
            const known = orm
              .select({ id: chatCards.cardId })
              .from(chatCards)
              .where(
                and(eq(chatCards.conversationId, input.conversationId), eq(chatCards.cardId, part.cardId)),
              )
              .get();
            if (!known) return err(NotFoundError({ entity: 'card', id: part.cardId }));
            parts.push({ type: 'card', cardId: part.cardId });
          }
        }
        const appended = base.appendMessage({
          conversationId: input.conversationId,
          role: input.role,
          content: parts,
          runId: input.runId ?? null,
          ...(input.id ? { id: input.id } : {}),
        });
        if (!appended.ok) return appended;
        const m = appended.value;
        return ok({
          id: m.id,
          role: input.role,
          parts: partsOf(m.content),
          runId: m.runId,
          createdAt: m.createdAt,
        });
      });
    },

    putCard(input) {
      const card = cardSchema.safeParse(input.card);
      if (!card.success) return invalid('card', card.error);
      return inTransaction(db, 'card', () => {
        const conversation = live(input.conversationId);
        return conversation.ok
          ? ok(storeCard(input.conversationId, input.card, input.runId ?? null))
          : conversation;
      });
    },

    rename(id, title, options) {
      const nextTitle = redactText(title.trim()).slice(0, MAX_TITLE);
      return change(
        id,
        options?.preserveUpdatedAt ? { title: nextTitle } : { title: nextTitle, updatedAt: db.clock() },
      );
    },
    setProject(id, projectId) {
      if (
        projectId !== null &&
        !orm.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()
      )
        return err(NotFoundError({ entity: 'project', id: projectId }));
      return change(id, { projectId, updatedAt: db.clock() });
    },
    archive: (id) => change(id, { archivedAt: db.clock() }),
    unarchive: (id) => change(id, { archivedAt: null }),
    remove: (id) => change(id, { deletedAt: db.clock() }, true),
    restore: (id) => change(id, { deletedAt: null }, true),
    purge: (id) => base.remove(id),

    linkRun(conversationId, runId) {
      return inTransaction(db, 'run', () => {
        const conversation = live(conversationId);
        if (!conversation.ok) return conversation;
        const run = orm.select().from(agentRuns).where(eq(agentRuns.runId, runId)).get();
        if (run?.conversationId && run.conversationId !== conversationId) {
          return err(
            ConflictError({ entity: 'run', id: runId }, { detail: 'linked to another conversation' }),
          );
        }
        if (run) {
          orm.update(agentRuns).set({ conversationId }).where(eq(agentRuns.runId, runId)).run();
          return ok(undefined);
        }
        const now = db.clock();
        return attemptWrite(db, 'run', () => {
          orm
            .insert(agentRuns)
            .values({ runId, conversationId, status: 'running', lastSeq: 0, startedAt: now, updatedAt: now })
            .run();
        });
      });
    },
  };
}
