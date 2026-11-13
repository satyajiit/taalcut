// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A TemplateMetaPatch (core) as the lineage's column changes, checked: names cleaned, tags normalised by core's
 * templateTagSchema (at most MAX_TEMPLATE_TAGS, duplicates dropped), trend dates and provenance validated. The
 * library never trusts that its caller validated.
 */
import {
  err,
  MAX_TEMPLATE_TAGS,
  ok,
  templateProvenanceSchema,
  templateTagSchema,
  trendFreshnessSchema,
  ValidationError,
  type Result,
  type TemplateMetaPatch,
  type TemplateProvenance,
  type TrendFreshness,
} from '@taalcut/core';
import { cleanText } from './canonical';
import { templateNameKey } from './template-name-key';
import type { TemplateRow } from './template-rows';

export type LineageChanges = Partial<
  Pick<
    TemplateRow,
    | 'name'
    | 'nameKey'
    | 'listed'
    | 'archivedAt'
    | 'tags'
    | 'folderId'
    | 'favourite'
    | 'trendDate'
    | 'trendSource'
    | 'provenance'
  >
>;

export function cleanName(name: string): Result<string> {
  const clean = cleanText(name);
  return clean && clean.length <= 120 ? ok(clean) : err(ValidationError({ field: 'name' }));
}

export function checkedTags(tags: readonly string[]): Result<string[]> {
  if (tags.length > MAX_TEMPLATE_TAGS) return err(ValidationError({ field: 'tags' }));
  const out: string[] = [];
  for (const tag of tags) {
    const parsed = templateTagSchema.safeParse(tag);
    if (!parsed.success) return err(ValidationError({ field: 'tags' }));
    if (!out.includes(parsed.data)) out.push(parsed.data);
  }
  return ok(out);
}

export function checkedTrend(
  trend: TrendFreshness | null,
): Result<Pick<TemplateRow, 'trendDate' | 'trendSource'>> {
  if (trend === null) return ok({ trendDate: null, trendSource: null });
  const parsed = trendFreshnessSchema.safeParse(trend);
  return parsed.success
    ? ok({ trendDate: parsed.data.date, trendSource: parsed.data.source })
    : err(ValidationError({ field: 'trendFreshness' }));
}

export function checkedProvenance(provenance: TemplateProvenance | null): Result<TemplateProvenance | null> {
  if (provenance === null) return ok(null);
  const parsed = templateProvenanceSchema.safeParse(provenance);
  return parsed.success ? ok(parsed.data) : err(ValidationError({ field: 'provenance' }));
}

/** The columns `patch` changes; `archivedAt` keeps the first archive time. */
export function lineageChanges(
  patch: TemplateMetaPatch,
  before: Pick<TemplateRow, 'archivedAt'>,
  now: number,
): Result<LineageChanges> {
  const changes: LineageChanges = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (!name.ok) return name;
    changes.name = name.value;
    changes.nameKey = templateNameKey(name.value);
  }
  if (patch.listed !== undefined) changes.listed = patch.listed;
  if (patch.archived !== undefined) changes.archivedAt = patch.archived ? (before.archivedAt ?? now) : null;
  if (patch.tags !== undefined) {
    const tags = checkedTags(patch.tags);
    if (!tags.ok) return tags;
    changes.tags = tags.value;
  }
  if (patch.folderId !== undefined) changes.folderId = patch.folderId;
  if (patch.favourite !== undefined) changes.favourite = patch.favourite;
  if (patch.trendFreshness !== undefined) {
    const trend = checkedTrend(patch.trendFreshness);
    if (!trend.ok) return trend;
    Object.assign(changes, trend.value);
  }
  if (patch.provenance !== undefined) {
    const provenance = checkedProvenance(patch.provenance);
    if (!provenance.ok) return provenance;
    changes.provenance = provenance.value;
  }
  return ok(changes);
}
