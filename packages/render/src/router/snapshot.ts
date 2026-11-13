// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stored render as a window may see it (renderSnapshotSchema): the
 * request, the request key, the file path, the composition hash and the
 * full QA report stay behind; progress comes from this process's live
 * exports (the store keeps none).
 */
import {
  ok,
  renderSnapshotSchema,
  type AsyncResult,
  type ProjectId,
  type RenderRecord,
  type RenderSnapshot,
  type RenderStore,
} from '@taalcut/core';
import type { LiveRenders } from '../engine/live';

const SNAPSHOT_KEYS = Object.keys(renderSnapshotSchema.shape) as (keyof RenderSnapshot)[];

export function snapshotOf(record: RenderRecord, live?: Pick<LiveRenders, 'progress'>): RenderSnapshot {
  const picked = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, record[key]])) as RenderSnapshot;
  return { ...picked, progress: live?.progress(record.id) ?? record.progress ?? null };
}

/** Renders newest first, soft-deleted ones left out. */
export async function listSnapshots(
  store: RenderStore,
  live: Pick<LiveRenders, 'progress'>,
  filter: { readonly projectId?: ProjectId; readonly limit?: number },
): AsyncResult<RenderSnapshot[]> {
  const listed = await store.list({
    ...(filter.projectId ? { projectId: filter.projectId } : {}),
    ...(filter.limit ? { limit: filter.limit } : {}),
    includeDeleted: false,
  });
  if (!listed.ok) return listed;
  const snapshots = listed.value
    .filter((record) => record.deletedAt === null)
    .map((record) => snapshotOf(record, live))
    .sort((a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
  return ok(snapshots);
}
