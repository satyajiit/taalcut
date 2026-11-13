// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TemplateStore.list's filters: listing, archive, project, fingerprint and full text (Phase 2), then P3-V14's
 * tags (any of them), folder ('none': in no folder), favourite, format, language, origin and stale (a trend date
 * older than `templates.staleAfterDays`; a template without one is never stale). Each absent filter is "any".
 * Full text matches every word as a prefix over the head's name, slot intents, overlay text and the tags.
 */
import type { TemplateListQuery } from '@taalcut/core';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { templates, templateVersions } from '../schema/templates';
import { ftsPrefixQuery } from './canonical';

const DAY_MS = 86_400_000;

export interface FilterContext {
  readonly now: number;
  readonly staleAfterDays: number;
}

/**
 * The latest YYYY-MM-DD that is stale at `now`: a date is stale when its midnight (UTC) is more than
 * `staleAfterDays` days before now (templates' isStale), so every date up to the day of (cutoff - 1 ms) is.
 */
export function lastStaleDate(context: FilterContext): string {
  return new Date(context.now - context.staleAfterDays * DAY_MS - 1).toISOString().slice(0, 10);
}

function staleFilter(stale: boolean, context: FilterContext): SQL {
  const last = lastStaleDate(context);
  return stale
    ? sql`(${templates.trendDate} IS NOT NULL AND ${templates.trendDate} <= ${last})`
    : sql`(${templates.trendDate} IS NULL OR ${templates.trendDate} > ${last})`;
}

function tagsFilter(tags: readonly string[]): SQL {
  const any = sql.join(
    tags.map((tag) => sql`${tag}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM json_each(${templates.tags}) tag WHERE tag.value IN (${any}))`;
}

/** The conditions for `query`, or null when its text has no word to search for (nothing can match). */
export function listFilters(query: TemplateListQuery, context: FilterContext): SQL | null | undefined {
  const match = query.query ? ftsPrefixQuery(query.query) : undefined;
  if (query.query && !match) return null;
  const { folderId } = query;
  return and(
    query.includeArchived ? undefined : isNull(templates.archivedAt),
    query.includeUnlisted ? undefined : eq(templates.listed, true),
    query.projectId ? eq(templates.projectId, query.projectId) : undefined,
    query.fingerprint
      ? sql`EXISTS (SELECT 1 FROM template_versions f WHERE f.template_id = ${templates.id} AND f.fingerprint = ${query.fingerprint})`
      : undefined,
    match
      ? sql`${templates.id} IN (SELECT template_id FROM template_fts WHERE template_fts MATCH ${match})`
      : undefined,
    query.tags && query.tags.length > 0 ? tagsFilter(query.tags) : undefined,
    folderId === undefined
      ? undefined
      : folderId === 'none'
        ? isNull(templates.folderId)
        : eq(templates.folderId, folderId),
    query.favourite === undefined ? undefined : eq(templates.favourite, query.favourite),
    query.formatId ? eq(templateVersions.formatId, query.formatId) : undefined,
    query.language ? eq(templateVersions.language, query.language) : undefined,
    query.origin ? eq(templateVersions.origin, query.origin) : undefined,
    query.stale === undefined ? undefined : staleFilter(query.stale, context),
  );
}
