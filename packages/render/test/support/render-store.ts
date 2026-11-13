// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An in-memory RenderStore that honours core's port (the library lane
 * implements the real one): create refuses a duplicate id, list filters by
 * project, batch, deletion and request key and sorts newest first, update patches
 * only the allowed fields and bumps nothing else.
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  type RenderFilter,
  type RenderId,
  type RenderPatch,
  type RenderRecord,
  type RenderStore,
} from '@taalcut/core';

export interface MemoryRenderStore extends RenderStore {
  readonly records: Map<RenderId, RenderRecord & { readonly requestKey: string }>;
  /** Every update, in order, for assertions on who wrote what. */
  readonly updates: { readonly id: RenderId; readonly patch: RenderPatch }[];
}

const ACTIVE = new Set(['queued', 'rendering', 'checking', 'fixing', 'ready', 'needsAttention']);

export function memoryRenderStore(): MemoryRenderStore {
  const records = new Map<RenderId, RenderRecord & { readonly requestKey: string }>();
  const updates: { id: RenderId; patch: RenderPatch }[] = [];
  return {
    records,
    updates,
    async create(record) {
      if (records.has(record.id)) return err(ConflictError({ entity: 'render', id: record.id }));
      const stored = { ...record, progress: null };
      records.set(record.id, stored);
      return ok(stored);
    },
    async get(id) {
      const record = records.get(id);
      return record ? ok(record) : err(NotFoundError({ entity: 'render', id }));
    },
    async list(filter: RenderFilter = {}) {
      let list = [...records.values()];
      if (filter.projectId) list = list.filter((record) => record.projectId === filter.projectId);
      if (filter.batchId) list = list.filter((record) => record.batchId === filter.batchId);
      if (!filter.includeDeleted) list = list.filter((record) => record.deletedAt === null);
      if (filter.requestKey)
        list = list.filter((record) => record.requestKey === filter.requestKey && ACTIVE.has(record.status));
      list.sort((a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : -1));
      return ok(filter.limit ? list.slice(0, filter.limit) : list);
    },
    async update(id, patch) {
      const record = records.get(id);
      if (!record) return err(NotFoundError({ entity: 'render', id }));
      const next = { ...record, ...patch };
      records.set(id, next);
      updates.push({ id, patch });
      return ok(next);
    },
  };
}
