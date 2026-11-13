// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's MemoryStore (LRN1-MEM) over migration 30's `memory_items`. An item is one row (no versions: `put` names the
 * revision it replaces, core.conflict otherwise). A project or template scope must name one that exists. Writes
 * given a CommandContext are staged on the command's unit of work, so they commit with its audit row. Lists join
 * the project's or template's name; a query ranks by FTS5 (`memory_fts`, kept by triggers).
 */
import {
  ConflictError,
  err,
  MEMORY_LIST_MAX,
  NotFoundError,
  ok,
  type MemoryFilter,
  type MemoryId,
  type MemoryItem,
  type MemoryItemView,
  type MemoryScope,
  type MemoryStore,
  type Result,
} from '@taalcut/core';
import { and, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { projects } from '../schema/chat';
import { templates } from '../schema/templates';
import { stagedWriter } from '../stores/staged-write';
import { memoryKeywordRanks } from './memory-keywords';
import { memoryScopeName } from './memory-scope-name';
import { memoryColumns, parsedMemoryItem, rowItem, rowView } from './memory-rows';
import { memoryItems } from './memory-table';

export interface MemoryStoreOptions {
  /** createLibraryPorts(db).commands: writes with a context commit with the command's audit row. */
  readonly commands?: CommandStager;
}

const MISSING = (id: string) => err(NotFoundError({ entity: 'memory', id }));

function scopeCondition(scope: MemoryScope): SQL | undefined {
  if (scope.kind === 'user') return eq(memoryItems.scope, 'user');
  if (scope.kind === 'project') return eq(memoryItems.projectId, scope.projectId);
  return eq(memoryItems.templateId, scope.templateId);
}

/** The filter's conditions, `query` and `limit` aside. An empty scope list matches nothing. */
function conditions(filter: MemoryFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (filter.scopes)
    parts.push(filter.scopes.length === 0 ? sql`0` : or(...filter.scopes.map(scopeCondition)));
  if (filter.kinds)
    parts.push(filter.kinds.length === 0 ? sql`0` : inArray(memoryItems.scope, [...filter.kinds]));
  if (filter.sources)
    parts.push(filter.sources.length === 0 ? sql`0` : inArray(memoryItems.source, [...filter.sources]));
  if (filter.dataKind) parts.push(eq(memoryItems.dataKind, filter.dataKind));
  return and(...parts);
}

export function createMemoryStore(db: LibraryDatabase, options: MemoryStoreOptions = {}): MemoryStore {
  const { orm } = db;
  const write = stagedWriter(db, options.commands, 'memory');
  const row = (id: MemoryId) => orm.select().from(memoryItems).where(eq(memoryItems.id, id)).get();

  /** The scope's project or template exists. */
  function scopeExists(scope: MemoryScope): Result<void> {
    const named = memoryScopeName(db, scope);
    return named.ok ? ok(undefined) : named;
  }

  function views(filter: MemoryFilter): Result<MemoryItemView[]> {
    const limit = Math.max(1, Math.min(MEMORY_LIST_MAX, Math.floor(filter.limit ?? MEMORY_LIST_MAX)));
    const ranks = filter.query === undefined ? undefined : memoryKeywordRanks(db, filter.query);
    if (ranks && ranks.size === 0) return ok([]);
    const where = and(conditions(filter), ranks ? inArray(memoryItems.id, [...ranks.keys()]) : undefined);
    const rows = orm
      .select({ item: memoryItems, projectName: projects.name, templateName: templates.name })
      .from(memoryItems)
      .leftJoin(projects, eq(projects.id, memoryItems.projectId))
      .leftJoin(templates, eq(templates.id, memoryItems.templateId))
      .where(where)
      .orderBy(desc(memoryItems.updatedAt), desc(memoryItems.id))
      .all();
    // Newest first; with a query, best match first (bm25), newest breaking ties (the sort is stable).
    const ordered = ranks
      ? [...rows].sort((a, b) => (ranks.get(a.item.id) ?? 0) - (ranks.get(b.item.id) ?? 0))
      : rows;
    const out: MemoryItemView[] = [];
    for (const found of ordered.slice(0, limit)) {
      const view = rowView(found.item, found.projectName ?? found.templateName ?? null);
      if (!view.ok) return view;
      out.push(view.value);
    }
    return ok(out);
  }

  return {
    async create(item, context) {
      const parsed = parsedMemoryItem(item);
      if (!parsed.ok) return parsed;
      const check = (): Result<void> =>
        row(item.id)
          ? err(ConflictError({ entity: 'memory', id: item.id }))
          : scopeExists(parsed.value.scope);
      const saved = write(
        context,
        check,
        () => void orm.insert(memoryItems).values(memoryColumns(parsed.value)).run(),
      );
      return saved.ok ? parsed : saved;
    },

    async put(item, expectedRevision, context) {
      const parsed = parsedMemoryItem(item);
      if (!parsed.ok) return parsed;
      const check = (): Result<void> => {
        const current = row(item.id);
        if (!current) return MISSING(item.id);
        if (current.revision !== expectedRevision)
          return err(
            ConflictError({ entity: 'memory', id: item.id }, { detail: `revision is ${current.revision}` }),
          );
        return scopeExists(parsed.value.scope);
      };
      const saved = write(context, check, () => {
        orm.update(memoryItems).set(memoryColumns(parsed.value)).where(eq(memoryItems.id, item.id)).run();
      });
      return saved.ok ? parsed : saved;
    },

    async get(memoryId): Promise<Result<MemoryItem>> {
      const found = row(memoryId);
      return found ? rowItem(found) : MISSING(memoryId);
    },

    list: async (filter = {}) => views(filter),

    async count(filter = {}) {
      const found = orm.select({ n: count() }).from(memoryItems).where(conditions(filter)).get();
      return ok(found?.n ?? 0);
    },

    async remove(memoryId, context) {
      const check = () => (row(memoryId) ? ok(undefined) : MISSING(memoryId));
      return write(context, check, () => {
        orm.delete(memoryItems).where(eq(memoryItems.id, memoryId)).run();
      });
    },
  };
}
