// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Templates as a managed library (P3-V14, P3-B12, P3-L2): tags, favourites, trend dates, folders and where a
 * template came from (the hub, a file, a starter). This is library metadata kept beside a lineage, never inside
 * the immutable Template documents, so editing it makes no new version.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { APP_LOCALES } from '../basics/locales';
import { idSchema } from '../basics/ids';
import { defineSetting } from '../ports/preferences';
import { hubHandleSchema } from '../hub/hub-template';
import { starterIdSchema } from './starters';

/** NFC, lower case where the script has case, inner spaces to one hyphen; letters, marks and digits of any script. */
export const templateTagSchema = z
  .string()
  .trim()
  .normalize('NFC')
  .toLowerCase()
  .overwrite((tag) => tag.replace(/\s+/gu, '-'))
  .pipe(
    z
      .string()
      .min(1)
      .max(32)
      .regex(/^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u),
  );
export const MAX_TEMPLATE_TAGS = 12;

/** Where a trend date came from: the reference's analysis, the hub entry, or the person. */
export const TREND_SOURCES = ['reference', 'hub', 'user'] as const;
export const trendFreshnessSchema = z.object({ date: z.iso.date(), source: z.enum(TREND_SOURCES) });
export type TrendFreshness = z.output<typeof trendFreshnessSchema>;

/** A trend date older than this many days marks the template "may be stale". */
export const STALE_AFTER_DAYS_SETTING = defineSetting(
  'templates.staleAfterDays',
  z.int().min(7).max(3650),
  90,
);

export const PROVENANCE_KINDS = ['hub', 'file', 'starter'] as const;
/** Where a template came from; null on summaries for the person's own. */
export const templateProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hub'),
    hubId: idSchema<'HubTemplate'>(),
    version: z.int().min(1),
    handle: hubHandleSchema,
    licence: z.literal('CC0-1.0'),
    forkedAt: z.int().nonnegative(),
    /** A later index no longer lists it (hidden or withdrawn). */
    removed: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('file'),
    importedAt: z.int().nonnegative(),
    /** The hub id the file carried, if it was a hub template. */
    hubId: idSchema<'HubTemplate'>().nullable(),
  }),
  z.object({ kind: z.literal('starter'), starterId: starterIdSchema, locale: z.enum(APP_LOCALES) }),
]);
export type TemplateProvenance = z.output<typeof templateProvenanceSchema>;

export const templateFolderSchema = z.object({
  id: idSchema<'TemplateFolder'>(),
  name: z.string().min(1).max(60),
  templates: z.int().nonnegative(),
  createdAt: z.int().nonnegative(),
});
export type TemplateFolder = z.output<typeof templateFolderSchema>;

export const TEMPLATE_SORTS = ['updated', 'name', 'trend', 'favourite', 'used'] as const;
export type TemplateSort = (typeof TEMPLATE_SORTS)[number];
