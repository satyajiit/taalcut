// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What fit reads once per call (LRN1-TPL): the templates in scope with their heads, and the pool's shots. Templates
 * named by id are read whatever their listing; otherwise every listed, unarchived template (in a folder or with a
 * tag, when asked). The pool is read in one list, oldest capture first, at most MAX_POOL_SHOTS; a shot without a
 * vector (not embedded yet) can't be matched by meaning and is left out, as casting's search never finds it.
 */
import {
  all,
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type FitPool,
  type FitTemplateScope,
  type ShotProfile,
  type ShotProfileFilter,
  type ShotProfileSource,
  type Template,
  type TemplateId,
  type TemplateStore,
  type TemplateSummary,
} from '@taalcut/core';
import { listTemplateIds, migrateTemplate } from '@taalcut/templates';
import { TemplateNotFound } from '../errors';

/** The most shots one fit reads: 2,000 × 1,600 slots × 768 dimensions stays a few seconds on the CPU. */
export const MAX_POOL_SHOTS = 2000;

export interface TemplateHead {
  readonly summary: TemplateSummary;
  readonly template: Template;
}

export interface LoadedPool {
  readonly profiles: readonly ShotProfile[];
  readonly truncated: boolean;
}

function scopedIds(store: Pick<TemplateStore, 'list'>, scope: FitTemplateScope): AsyncResult<TemplateId[]> {
  if (scope.templateIds) return Promise.resolve(ok([...new Set(scope.templateIds)]));
  return listTemplateIds(store, {
    includeUnlisted: false,
    includeArchived: false,
    ...(scope.folderId ? { folderId: scope.folderId } : {}),
    ...(scope.tags ? { tags: scope.tags } : {}),
  });
}
async function headOf(store: Pick<TemplateStore, 'get'>, templateId: TemplateId): AsyncResult<TemplateHead> {
  const stored = await store.get(templateId);
  if (!stored.ok) return NotFoundError.is(stored.error) ? err(TemplateNotFound({ templateId })) : stored;
  const template = migrateTemplate(stored.value.json, stored.value.schemaVersion);
  return template.ok ? ok({ summary: stored.value.summary, template: template.value }) : template;
}

/** The ids in scope, in a stable order (sorted), for the vectors to sync before the heads are read. */
export async function templatesInScope(
  store: Pick<TemplateStore, 'list'>,
  scope: FitTemplateScope,
): AsyncResult<TemplateId[]> {
  const ids = await scopedIds(store, scope);
  return ids.ok ? ok([...ids.value].sort()) : ids;
}

export const readHeads = async (
  store: Pick<TemplateStore, 'get'>,
  templateIds: readonly TemplateId[],
): AsyncResult<TemplateHead[]> =>
  all(await Promise.all(templateIds.map((templateId) => headOf(store, templateId))));

export async function loadPool(
  profiles: Pick<ShotProfileSource, 'list'>,
  pool: FitPool,
  dimensions: number,
  signal?: AbortSignal,
): AsyncResult<LoadedPool> {
  const filter: ShotProfileFilter = {
    ...(pool.sourceIds ? { sourceIds: pool.sourceIds } : {}),
    ...(pool.assetIds ? { assetIds: pool.assetIds } : {}),
    ...(pool.capturedFrom !== undefined ? { capturedFrom: pool.capturedFrom } : {}),
    ...(pool.capturedTo !== undefined ? { capturedTo: pool.capturedTo } : {}),
  };
  const listed = await profiles.list(filter, MAX_POOL_SHOTS + 1, signal);
  if (!listed.ok) return listed;
  return ok({
    profiles: listed.value
      .slice(0, MAX_POOL_SHOTS)
      .filter((profile) => profile.embedding.length === dimensions),
    truncated: listed.value.length > MAX_POOL_SHOTS,
  });
}
