// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template index's writer and reader for one embedding space (LRN1-TPL). `sync` brings some templates up to
 * date (a committed write, or fit making sure of what it reads); `reconcile` brings the whole index up to date: every
 * template in the store synced, and every template the index holds that the store doesn't removed. It runs when a
 * space's index is first opened (at start, and in a new space after the embedding model changed: its index starts
 * empty). Runs never overlap: each waits for the one before, so two writes of one template can't interleave.
 */
import {
  chunk,
  createSerialQueue,
  ok,
  parseTemplateVectorId,
  type AsyncResult,
  type Result,
  type TemplateId,
  type TemplateListQuery,
} from '@taalcut/core';
import { NO_SYNC, syncTemplates, type TemplateVectorDeps, type TemplateVectorSync } from './sync';

export interface TemplateVectors {
  readonly dimensions: number;
  /** These templates' sets up to date with their heads (removed when gone). */
  sync(templateIds: readonly TemplateId[], signal?: AbortSignal): AsyncResult<TemplateVectorSync>;
  /** Every template's set up to date, and the vectors of templates no longer in the store removed. */
  reconcile(signal?: AbortSignal): AsyncResult<TemplateVectorSync>;
  /** Stored vectors by id; ids not stored are absent. */
  get(ids: readonly string[]): Result<Map<string, Float32Array>>;
}

const PAGE = 200;

/** Every template id a list query matches, page by page (the index's catch-up, and fit's scope). */
export async function listTemplateIds(
  store: Pick<TemplateVectorDeps['store'], 'list'>,
  query: Omit<TemplateListQuery, 'limit' | 'cursor'>,
): AsyncResult<TemplateId[]> {
  const ids: TemplateId[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({ ...query, limit: PAGE, ...(cursor ? { cursor } : {}) });
    if (!page.ok) return page;
    ids.push(...page.value.items.map((item) => item.id));
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor);
  return ok(ids);
}

/** Removes every vector whose template the store no longer has, and any id that isn't a template-index id. */
function dropGone(deps: TemplateVectorDeps, known: ReadonlySet<string>): Result<number> {
  const listed = deps.index.ids();
  if (!listed.ok) return listed;
  const gone = new Set<string>();
  const foreign: string[] = [];
  for (const id of listed.value) {
    const key = parseTemplateVectorId(id);
    if (!key) foreign.push(id);
    else if (!known.has(key.templateId)) gone.add(key.templateId);
  }
  for (const part of chunk([...gone], 500)) {
    const dropped = deps.index.removeWhere({ sourceId: part });
    if (!dropped.ok) return dropped;
  }
  if (foreign.length > 0) {
    const dropped = deps.index.remove(foreign);
    if (!dropped.ok) return dropped;
  }
  return ok(gone.size);
}

export function createTemplateVectors(deps: TemplateVectorDeps): TemplateVectors {
  /** Each run after every earlier one has finished, whatever its outcome; its own caller sees how it ended. */
  const runs = createSerialQueue();

  return {
    dimensions: deps.index.dimensions,
    sync: (templateIds, signal) =>
      templateIds.length === 0
        ? Promise.resolve(ok(NO_SYNC))
        : runs.run(() => syncTemplates(deps, templateIds, signal)),
    reconcile: (signal) =>
      runs.run(async () => {
        // Unlisted and archived templates too: the index holds every template the store keeps.
        const ids = await listTemplateIds(deps.store, { includeUnlisted: true, includeArchived: true });
        if (!ids.ok) return ids;
        const synced = await syncTemplates(deps, ids.value, signal);
        if (!synced.ok) return synced;
        const removed = dropGone(deps, new Set(ids.value));
        if (!removed.ok) return removed;
        return ok({ ...synced.value, removed: synced.value.removed + removed.value });
      }),
    get: (ids) => deps.index.get(ids),
  };
}
