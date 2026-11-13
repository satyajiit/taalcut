// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TemplateStore.list: one query over each lineage joined with its head, filtered (template-list-filters.ts),
 * sorted and keyset-paged (template-list-order.ts). Every summary field comes from columns, so a page of 200
 * needs no document read; only the contact sheet's grid is read with json_extract.
 */
import {
  ok,
  STALE_AFTER_DAYS_SETTING,
  type Result,
  type TemplateListPage,
  type TemplateListQuery,
  type TemplateSummary,
} from '@taalcut/core';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { templateMedia, templates, templateVersions } from '../schema/templates';
import { storedSetting } from './stored-setting';
import { listFilters } from './template-list-filters';
import { afterCursor, encodeListCursor, listOrder, orderBy, timelinesUsing } from './template-list-order';
import { mediaOfRow } from './template-media-store';
import { toSummary } from './template-rows';

const sheetFact = (path: string) => sql<unknown>`json_extract(${templateVersions.document}, ${path})`;

/** The contact sheet's grid as json_extract read it, or null when the head names none (or it doesn't parse). */
function sheetOf(row: {
  readonly asset: string | null;
  readonly mediaType: unknown;
  readonly columns: unknown;
  readonly rows: unknown;
  readonly width: unknown;
  readonly height: unknown;
}): TemplateSummary['contactSheet'] {
  const { asset, mediaType } = row;
  if (!asset || (mediaType !== 'image/jpeg' && mediaType !== 'image/webp')) return null;
  return {
    asset,
    mediaType,
    columns: Number(row.columns),
    rows: Number(row.rows),
    tile: { width: Number(row.width), height: Number(row.height) },
  };
}

/** The lineages `where` selects, joined with their heads, in `order`, at most `limit`: every summary field. */
export function selectTemplateRows(db: LibraryDatabase, where: SQL | undefined, order: SQL[], limit: number) {
  return db.orm
    .select({
      lineage: templates,
      head: {
        origin: templateVersions.origin,
        platform: templateVersions.platform,
        durationValue: templateVersions.durationValue,
        durationRateNum: templateVersions.durationRateNum,
        durationRateDen: templateVersions.durationRateDen,
        slotCount: templateVersions.slotCount,
        bpm: templateVersions.bpm,
        contactSheet: templateVersions.contactSheet,
        formatId: templateVersions.formatId,
        language: templateVersions.language,
        styleId: templateVersions.styleId,
        approvedSlots: templateVersions.approvedSlots,
        slotStrip: templateVersions.slotStrip,
      },
      sheet: {
        mediaType: sheetFact('$.contactSheet.mediaType'),
        columns: sheetFact('$.contactSheet.columns'),
        rows: sheetFact('$.contactSheet.rows'),
        width: sheetFact('$.contactSheet.tile.width'),
        height: sheetFact('$.contactSheet.tile.height'),
      },
      used: timelinesUsing,
      media: templateMedia,
    })
    .from(templates)
    .innerJoin(
      templateVersions,
      and(eq(templateVersions.templateId, templates.id), eq(templateVersions.version, templates.headVersion)),
    )
    .leftJoin(templateMedia, eq(templateMedia.templateId, templates.id))
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .all();
}

export type TemplateRow = ReturnType<typeof selectTemplateRows>[number];

export const summaryOfRow = ({ lineage, head, sheet, media }: TemplateRow): TemplateSummary =>
  toSummary(lineage, head, sheetOf({ asset: head.contactSheet, ...sheet }), media ? mediaOfRow(media) : null);

export function listTemplates(db: LibraryDatabase, query: TemplateListQuery): Result<TemplateListPage> {
  const filters = listFilters(query, {
    now: db.clock(),
    staleAfterDays: storedSetting(db, STALE_AFTER_DAYS_SETTING),
  });
  if (filters === null) return ok({ items: [], nextCursor: null });
  const order = listOrder(query);
  const after = query.cursor ? afterCursor(order, query.cursor) : undefined;
  if (after && !after.ok) return after;
  const limit = query.limit;
  const rows = selectTemplateRows(db, and(filters, after?.value), orderBy(order), limit + 1);
  const page = rows.slice(0, limit);
  const items = page.map(summaryOfRow);
  const last = page.at(-1);
  return ok({
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeListCursor(order, { ...last.lineage, used: Number(last.used) })
        : null,
  });
}
