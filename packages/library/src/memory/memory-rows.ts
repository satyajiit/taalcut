// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Memory rows ↔ core's MemoryItem (LRN1-MEM): the scope as a kind plus its project or template column, `data` as
 * JSON with its kind beside it. Every item written or read goes through core's memoryItemSchema, so a row that
 * stopped fitting it reads as core.validation, never as a half-item.
 */
import {
  err,
  memoryItemProblems,
  memoryItemSchema,
  ok,
  ValidationError,
  type MemoryItem,
  type MemoryItemView,
  type MemoryScope,
  type Result,
} from '@taalcut/core';
import type { MemoryRow } from './memory-table';

/** An item checked against core's schema and its problems: what the store writes and what a read returns. */
export function parsedMemoryItem(value: unknown): Result<MemoryItem> {
  const parsed = memoryItemSchema.safeParse(value);
  if (!parsed.success)
    return err(ValidationError({ field: 'memory' }, { detail: parsed.error.message.slice(0, 2000) }));
  const problem = memoryItemProblems(parsed.data)[0];
  return problem ? err(ValidationError({ field: 'memory' }, { detail: problem })) : ok(parsed.data);
}

export function memoryColumns(item: MemoryItem): MemoryRow {
  const { scope } = item;
  return {
    id: item.id,
    scope: scope.kind,
    projectId: scope.kind === 'project' ? scope.projectId : null,
    templateId: scope.kind === 'template' ? scope.templateId : null,
    text: item.text,
    source: item.source,
    dataKind: item.data?.kind ?? null,
    data: item.data,
    conversationId: item.conversationId,
    revision: item.revision,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function scopeOf(row: MemoryRow): MemoryScope | undefined {
  if (row.scope === 'user') return { kind: 'user' };
  if (row.scope === 'project' && row.projectId) return { kind: 'project', projectId: row.projectId };
  if (row.scope === 'template' && row.templateId) return { kind: 'template', templateId: row.templateId };
  return undefined;
}

export function rowItem(row: MemoryRow): Result<MemoryItem> {
  return parsedMemoryItem({
    id: row.id,
    scope: scopeOf(row),
    text: row.text,
    source: row.source,
    data: row.data ?? null,
    conversationId: row.conversationId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function rowView(row: MemoryRow, scopeName: string | null): Result<MemoryItemView> {
  const item = rowItem(row);
  return item.ok ? ok({ ...item.value, scopeName: row.scope === 'user' ? null : scopeName }) : item;
}
