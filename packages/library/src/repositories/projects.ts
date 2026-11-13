// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Projects, and conversations with their messages. */
import {
  err,
  newId,
  ok,
  ValidationError,
  type ConversationId,
  type MessageId,
  type Money,
  type ProjectId,
  type Result,
  type RunId,
} from '@taalcut/core';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { conversations, messages, projects, type MessageRole } from '../schema/chat';
import { redactSecrets } from '../secrets/redact';
import { writeProjectName, type ProjectNameGuard } from './project-name';
import { attemptWrite, found, inTransaction, missing, pageSize, touched } from './shared';

export type Project = typeof projects.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export interface ProjectRepository {
  /** `budgetCap`: the spending cap it starts with (P2-X1; project.create copies the default). */
  create(input: { name: string; id?: ProjectId; budgetCap?: Money | null }): Result<Project>;
  get(id: ProjectId): Result<Project>;
  /** Most recently updated first. */
  list(): Project[];
  rename(id: ProjectId, name: string, options?: ProjectNameGuard): Result<Project>;
  /** Deletes the project with its conversations, messages and audit log (cascade). */
  remove(id: ProjectId): Result<void>;
  /** Hides the project from the list (deleting in the UI archives it, undoably). Archiving twice keeps the first time. */
  archive(id: ProjectId): Result<Project>;
  unarchive(id: ProjectId): Result<Project>;
  /** Opening a project (for "recent" ordering); doesn't count as a change. */
  markOpened(id: ProjectId): Result<Project>;
}

export interface ConversationRepository {
  create(input: {
    projectId?: ProjectId | null;
    title?: string | null;
    id?: ConversationId;
  }): Result<Conversation>;
  get(id: ConversationId): Result<Conversation>;
  /** Most recently updated first. `null` lists chats outside any project. */
  listByProject(projectId: ProjectId | null, options?: { limit?: number }): Conversation[];
  setTitle(id: ConversationId, title: string | null): Result<Conversation>;
  remove(id: ConversationId): Result<void>;
  /** Appends a message and bumps the conversation's updatedAt, atomically. */
  appendMessage(input: {
    conversationId: ConversationId;
    role: MessageRole;
    content: unknown;
    runId?: RunId | null;
    id?: MessageId;
  }): Result<Message>;
  /** Oldest first. `afterId` pages forward (ids are time-ordered ULIDs). */
  listMessages(conversationId: ConversationId, options?: { afterId?: MessageId; limit?: number }): Message[];
}

function cleanName(name: string): Result<string> {
  const trimmed = name.trim();
  return trimmed ? ok(trimmed) : err(ValidationError({ field: 'name' }));
}

export function createProjectRepository(db: LibraryDatabase): ProjectRepository {
  const { orm } = db;
  const get = (id: ProjectId) =>
    found(orm.select().from(projects).where(eq(projects.id, id)).get(), 'project', id);
  return {
    create(input) {
      const name = cleanName(input.name);
      if (!name.ok) return name;
      const now = db.clock();
      const row: typeof projects.$inferInsert = {
        id: input.id ?? newId<'Project'>(),
        name: name.value,
        createdAt: now,
        updatedAt: now,
        budgetCapMicros: input.budgetCap?.micros ?? null,
        budgetCapCurrency: input.budgetCap?.currency ?? null,
      };
      return attemptWrite(db, 'project', () => orm.insert(projects).values(row).returning().get());
    },
    get,
    list: () => orm.select().from(projects).orderBy(desc(projects.updatedAt), desc(projects.id)).all(),
    rename(id, newName, options = {}) {
      const name = cleanName(newName);
      if (!name.ok) return name;
      return writeProjectName(db, id, name.value, options);
    },
    remove(id) {
      return inTransaction(db, 'project', () =>
        touched(orm.delete(projects).where(eq(projects.id, id)).run().changes, 'project', id),
      );
    },
    archive(id) {
      return inTransaction(db, 'project', () => {
        const now = db.clock();
        const row = orm
          .update(projects)
          .set({ archivedAt: sql`coalesce(${projects.archivedAt}, ${now})`, updatedAt: now })
          .where(eq(projects.id, id))
          .returning()
          .get();
        return found(row, 'project', id);
      });
    },
    unarchive(id) {
      return inTransaction(db, 'project', () =>
        found(
          orm
            .update(projects)
            .set({ archivedAt: null, updatedAt: db.clock() })
            .where(eq(projects.id, id))
            .returning()
            .get(),
          'project',
          id,
        ),
      );
    },
    markOpened(id) {
      return inTransaction(db, 'project', () =>
        found(
          orm.update(projects).set({ lastOpenedAt: db.clock() }).where(eq(projects.id, id)).returning().get(),
          'project',
          id,
        ),
      );
    },
  };
}

export function createConversationRepository(db: LibraryDatabase): ConversationRepository {
  const { orm } = db;
  const get = (id: ConversationId) =>
    found(orm.select().from(conversations).where(eq(conversations.id, id)).get(), 'conversation', id);
  return {
    create(input) {
      const now = db.clock();
      const row: Conversation = {
        id: input.id ?? newId<'Conversation'>(),
        projectId: input.projectId ?? null,
        title: input.title ?? null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
      };
      return attemptWrite(db, 'conversation', () => orm.insert(conversations).values(row).returning().get());
    },
    get,
    listByProject(projectId, options = {}) {
      const scope =
        projectId === null ? isNull(conversations.projectId) : eq(conversations.projectId, projectId);
      return orm
        .select()
        .from(conversations)
        .where(scope)
        .orderBy(desc(conversations.updatedAt), desc(conversations.id))
        .limit(pageSize(options.limit))
        .all();
    },
    setTitle(id, title) {
      return inTransaction(db, 'conversation', () => {
        const row = orm
          .update(conversations)
          .set({ title, updatedAt: db.clock() })
          .where(eq(conversations.id, id))
          .returning()
          .get();
        return found(row, 'conversation', id);
      });
    },
    remove(id) {
      return inTransaction(db, 'conversation', () =>
        touched(orm.delete(conversations).where(eq(conversations.id, id)).run().changes, 'conversation', id),
      );
    },
    appendMessage(input) {
      return inTransaction(db, 'message', () => {
        const now = db.clock();
        const bumped = orm
          .update(conversations)
          .set({ updatedAt: now })
          .where(eq(conversations.id, input.conversationId))
          .run();
        if (bumped.changes === 0) return missing('conversation', input.conversationId);
        const row: Message = {
          id: input.id ?? newId<'Message'>(),
          conversationId: input.conversationId,
          role: input.role,
          // Users paste keys into chats; they must not reach the database (P1-F5).
          content: redactSecrets(input.content),
          runId: input.runId ?? null,
          createdAt: now,
        };
        return ok(orm.insert(messages).values(row).returning().get());
      });
    },
    listMessages(conversationId, options = {}) {
      const after = options.afterId ? gt(messages.id, options.afterId) : undefined;
      return orm
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), after))
        .orderBy(asc(messages.id))
        .limit(pageSize(options.limit, 500, 5000))
        .all();
    },
  };
}
