// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.templates: read-only, served by the agent process from
 * @taalcut/templates' service; every change is a command
 * (template-commands.ts). Stored documents are migrated before they leave
 * the agent, so a window always gets Template v1. P3's reads (folders,
 * starters, a template as a file) are optional on the service until
 * @taalcut/templates implements them; the router answers
 * core.not_implemented meanwhile.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { APP_LOCALES, type AppLocale } from '../basics/locales';
import { idSchema, type TemplateId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { COMMAND_SOURCES } from '../commands/definition';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { callOptional } from '../ipc/not-served';
import { HUB_MAX_BYTES } from '../hub/hub-template';
import { rationalTimeSchema } from '../time/rational-time';
import { starterSummarySchema, type StarterSummary } from './starters';
import {
  styleProfileInputSchema,
  styleProfileViewSchema,
  type StyleProfileInput,
  type StyleProfileView,
} from './style-profile';
import {
  instagramCollectionSchema,
  instagramReelsPageSchema,
  instagramReelsQuerySchema,
  instagramSavedStatusSchema,
  type InstagramCollection,
  type InstagramReelsPage,
  type InstagramReelsQuery,
  type InstagramSavedStatus,
} from './instagram-saved';
import {
  MAX_TEMPLATE_TAGS,
  TEMPLATE_SORTS,
  templateFolderSchema,
  templateProvenanceSchema,
  templateTagSchema,
  trendFreshnessSchema,
  type TemplateFolder,
} from './template-library';
import {
  contactSheetSchema,
  FORMAT_IDS,
  languageTagSchema,
  REFERENCE_PLATFORMS,
  sha256Schema,
  templateMediaSchema,
  type ContactSheet,
  type FormatId,
} from './template-parts';
import type { TemplateProposals, TemplateProposeEditsInput } from './template-review';
import { templateProposalsSchema, templateProposeEditsInputSchema } from './template-review';
import { templateSchema, type Template } from './template-schema';

/** What a summary keeps of the head's contact sheet: enough for a list to crop its first frame (no get). */
export const templateSummarySheetSchema = contactSheetSchema.pick({
  asset: true,
  mediaType: true,
  columns: true,
  rows: true,
  tile: true,
});
export type TemplateSummarySheet = z.output<typeof templateSummarySheetSchema>;

export const templateSummarySchema = z.object({
  id: idSchema<'Template'>(),
  name: z.string().min(1).max(120),
  head: z.int().min(1),
  origin: z.enum(['reference', 'format', 'manual']),
  platform: z.enum(REFERENCE_PLATFORMS).nullable(),
  duration: rationalTimeSchema,
  slotCount: z.int().min(1),
  bpm: z.number().nullable(),
  /** The project it was made in; null for app-wide. */
  projectId: idSchema<'Project'>().nullable(),
  /** In "My templates". A format plan made for one brief is not, until saved. */
  listed: z.boolean(),
  archived: z.boolean(),
  /** The head's contact sheet (its template asset for templateAssetUrl, and its grid); null without one. */
  contactSheet: templateSummarySheetSchema.nullable(),
  /** The head's slots the user approved; the rest are still to check. */
  approvedSlots: z.int().nonnegative(),
  /** P3-V14: library metadata (no new version when it changes). */
  tags: z.array(templateTagSchema).max(MAX_TEMPLATE_TAGS),
  folderId: idSchema<'TemplateFolder'>().nullable(),
  favourite: z.boolean(),
  trendFreshness: trendFreshnessSchema.nullable(),
  provenance: templateProvenanceSchema.nullable(),
  /** The head's slot lengths in canvas frames, so a list row needs no get. */
  slotStrip: z.array(z.int().positive()).max(200),
  formatId: z.enum(FORMAT_IDS).nullable(),
  language: languageTagSchema.nullable(),
  styleId: idSchema<'Style'>().nullable(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
  /**
   * REF1: the reel's video and music kept on this Mac (one per template, every version shares it). Absent or null:
   * none, because it was made before REF1, from a format, or its media was removed; `templates.fetchMedia` gets it.
   */
  media: templateMediaSchema.nullable().optional(),
});
export type TemplateSummary = z.output<typeof templateSummarySchema>;

/** The head's facts a summary carries, so a list needs no get. */
export type TemplateHeadFacts = Pick<
  TemplateSummary,
  'contactSheet' | 'approvedSlots' | 'slotStrip' | 'formatId' | 'language' | 'styleId'
>;

/** A summary's head facts, read from the head (TemplateStore implementations and fakes). */
export function templateSummaryFacts(head: {
  readonly contactSheet?: ContactSheet | null;
  readonly slots?: readonly { readonly approved: boolean; readonly duration?: { readonly value: number } }[];
  readonly origin?: { readonly kind: string; readonly formatId?: FormatId };
  readonly language?: string | null;
  readonly styleId?: TemplateSummary['styleId'];
}): TemplateHeadFacts {
  const sheet = head.contactSheet;
  const slots = head.slots ?? [];
  return {
    contactSheet: sheet
      ? {
          asset: sheet.asset,
          mediaType: sheet.mediaType,
          columns: sheet.columns,
          rows: sheet.rows,
          tile: { width: sheet.tile.width, height: sheet.tile.height },
        }
      : null,
    approvedSlots: slots.filter((slot) => slot.approved).length,
    slotStrip: slots.flatMap((slot) => (slot.duration ? [slot.duration.value] : [])),
    formatId: head.origin?.formatId ?? null,
    language: head.language ?? null,
    styleId: head.styleId ?? null,
  };
}

/** What a template has before anyone tagged, filed, starred or dated it, and where none of it came from. */
export const NO_TEMPLATE_LIBRARY_META: Pick<
  TemplateSummary,
  'tags' | 'folderId' | 'favourite' | 'trendFreshness' | 'provenance'
> = { tags: [], folderId: null, favourite: false, trendFreshness: null, provenance: null };

export const templateVersionSummarySchema = z.object({
  version: z.int().min(1),
  parentVersion: z.int().min(1).nullable(),
  createdAt: z.int().nonnegative(),
  /** The command that made it; null for version 1. */
  command: z.string().max(100).nullable(),
  source: z.enum(COMMAND_SOURCES).nullable(),
  isHead: z.boolean(),
});
export type TemplateVersionSummary = z.output<typeof templateVersionSummarySchema>;

export const templateListQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  projectId: idSchema<'Project'>().optional(),
  fingerprint: sha256Schema.optional(),
  includeUnlisted: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  limit: z.int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  /** P3-V14 filters and sort. */
  tags: z.array(templateTagSchema).max(MAX_TEMPLATE_TAGS).optional(),
  /** 'none': not in any folder. */
  folderId: z.union([idSchema<'TemplateFolder'>(), z.literal('none')]).optional(),
  favourite: z.boolean().optional(),
  formatId: z.enum(FORMAT_IDS).optional(),
  language: languageTagSchema.optional(),
  origin: z.enum(['reference', 'format', 'manual']).optional(),
  /** Trend date older than STALE_AFTER_DAYS_SETTING. */
  stale: z.boolean().optional(),
  /** Absent: most recently changed first (Phase 2's order). */
  sort: z.enum(TEMPLATE_SORTS).optional(),
  /** Absent: 'desc'. */
  dir: z.enum(['asc', 'desc']).optional(),
});
export type TemplateListQuery = z.output<typeof templateListQuerySchema>;

export const templateListPageSchema = z.object({
  items: z.array(templateSummarySchema),
  nextCursor: z.string().nullable(),
});
export type TemplateListPage = z.output<typeof templateListPageSchema>;

/** LRN1-TPL: which lists found a hit: the words, the template's document vector, a slot's intent vector. */
export const TEMPLATE_SEARCH_MATCHES = ['words', 'meaning', 'slot'] as const;
export type TemplateSearchMatch = (typeof TEMPLATE_SEARCH_MATCHES)[number];

/**
 * The most hits one search returns: more than template-search-v1's lists can hold (200 word hits, 400 document and 400
 * slot-intent neighbours: 1,000 templates), so a search asked for this many returns every template it found. The
 * Templates page's list asks for it whenever the field has words: one answer for the list, its count and the panel.
 */
export const TEMPLATE_SEARCH_MAX_HITS = 2000;

export const templateSearchQuerySchema = templateListQuerySchema
  .pick({
    projectId: true,
    includeUnlisted: true,
    includeArchived: true,
    tags: true,
    folderId: true,
    favourite: true,
    formatId: true,
    language: true,
    origin: true,
    stale: true,
  })
  .extend({
    text: z.string().trim().min(1).max(200),
    limit: z.int().min(1).max(TEMPLATE_SEARCH_MAX_HITS).default(10),
  });
export type TemplateSearchQuery = z.output<typeof templateSearchQuerySchema>;

/** A matched slot as the head holds it: its place among the slots (from 0: "slot 3" is 2) and its intent as written. */
export const templateSearchSlotSchema = z.object({
  index: z.int().min(0),
  /** The template's own words (the user's or the Analyst's): shown as written, never translated. */
  intent: z.string().max(500),
});
export type TemplateSearchSlot = z.output<typeof templateSearchSlotSchema>;

export const templateSearchHitSchema = z.object({
  summary: templateSummarySchema,
  /** The fused score, 0..1: 1 is first in every list that could match. */
  score: z.number().min(0).max(1),
  matchedBy: z.array(z.enum(TEMPLATE_SEARCH_MATCHES)).min(1).max(3),
  /** The head slot whose intent was nearest the text, when the slot list found this template. */
  slotId: idSchema<'TemplateSlot'>().nullable(),
  /** That slot's place and intent, wherever `slotId` is set: a row says "slot 3's intent: …" without a read. */
  slot: templateSearchSlotSchema.optional(),
});
export type TemplateSearchHit = z.output<typeof templateSearchHitSchema>;

export const templateSearchResultSchema = z.object({
  hits: z.array(templateSearchHitSchema).max(TEMPLATE_SEARCH_MAX_HITS),
  /** 'keyword-only' while no embedding space is open; null when the vectors were searched. */
  degraded: z.enum(['keyword-only']).nullable(),
  /** The fusion's version (reported with eval numbers; bumped with any change of weights or lists). */
  fusion: z.string().min(1).max(64),
});
export type TemplateSearchResult = z.output<typeof templateSearchResultSchema>;

/** What a Format's plan expects for sound and captions (P3-V1). */
export const FORMAT_AUDIO = ['music', 'voice'] as const;
export const FORMAT_CAPTIONS = ['optional', 'recommended', 'required'] as const;

export const formatSummarySchema = z.object({
  id: z.enum(FORMAT_IDS),
  version: z.string().min(1),
  nameKey: z.string().min(1),
  descriptionKey: z.string().min(1),
  minSeconds: z.int().positive(),
  maxSeconds: z.int().positive(),
  /** The grid when the person gives none. */
  defaultBpm: z.int().min(80).max(180),
  audio: z.enum(FORMAT_AUDIO),
  captions: z.enum(FORMAT_CAPTIONS),
});
export type FormatSummary = z.output<typeof formatSummarySchema>;

/** Which template, at which version, as a file; `includeStyle` adds its look (no assets). */
export const templateDocumentInputSchema = z.object({
  templateId: idSchema<'Template'>(),
  version: z.int().min(1).optional(),
  includeStyle: z.boolean().default(false),
});
export type TemplateDocumentInput = z.output<typeof templateDocumentInputSchema>;

/** REF1: the template whose reel to fetch again from its origin link and keep. */
export const templateFetchMediaInputSchema = z.object({ id: idSchema<'Template'>() });
export type TemplateFetchMediaInput = z.output<typeof templateFetchMediaInputSchema>;

export const templatesContract = {
  list: ipc.input(templateListQuerySchema).output(templateListPageSchema),
  /** LRN1-TPL: the library's templates by words, meaning and slot intents, best first, each with what matched. */
  search: ipc.input(templateSearchQuerySchema).output(templateSearchResultSchema),
  /** Any version; default the head. */
  get: ipc
    .input(z.object({ templateId: idSchema<'Template'>(), version: z.int().min(1).optional() }))
    .output(z.object({ summary: templateSummarySchema, template: templateSchema })),
  versions: ipc
    .input(z.object({ templateId: idSchema<'Template'>() }))
    .output(z.array(templateVersionSummarySchema)),
  formats: ipc.output(z.array(formatSummarySchema)),
  /** P3-V14. */
  folders: ipc.output(z.array(templateFolderSchema)),
  /** P3-B3: the bundled starters for this language; with `forLibrary`, the best fit for the library first. */
  starters: ipc
    .input(z.object({ locale: z.enum(APP_LOCALES), forLibrary: z.boolean().default(true) }))
    .output(z.array(starterSummarySchema).max(10)),
  /** P3-V14: a `.taalcut-template` file's text (Hub template v0); main's files.saveTemplateAs writes it. */
  exportDocument: ipc
    .input(templateDocumentInputSchema)
    .output(z.object({ fileName: z.string().min(1).max(200), text: z.string().max(HUB_MAX_BYTES) })),
  /** Saved on Instagram: sign-in status, cached collections, and cached saved Reels. */
  instagramStatus: ipc.output(instagramSavedStatusSchema),
  instagramCollections: ipc.output(z.array(instagramCollectionSchema)),
  instagramReels: ipc.input(instagramReelsQuerySchema).output(instagramReelsPageSchema),
  /** LRN1-STY: a set's style profile, built when missing or stale (derived data: reading may build it). */
  styleProfile: ipc.input(styleProfileInputSchema).output(styleProfileViewSchema),
  /**
   * LRN1-STY: write the summary paragraph again (a model was installed, or consent given). Answers at once with the
   * summary `writing`; the paragraph follows with `library.changed` (entity 'styleProfile').
   */
  writeStyleSummary: ipc.input(styleProfileInputSchema).output(styleProfileViewSchema),
  /**
   * REF1: fetches a template's origin link again (without an account first, then with the Instagram session) and
   * keeps the reel as its media; answers the summary with `media` set. Runs a `templates.fetchReference` job, whose
   * progress is in the jobs feed. Errors: the fetch's (`templates.fetch_failed`, `.fetch_unavailable`,
   * `.reference_too_long`, `.no_video`) and `templates.no_origin_link` for a template with no link.
   */
  fetchMedia: ipc.input(templateFetchMediaInputSchema).output(templateSummarySchema),
  /** BRK1 "Tell Taalcut": proposed edits as data, nothing applied (template-review.ts). */
  proposeEdits: ipc.input(templateProposeEditsInputSchema).output(templateProposalsSchema),
};

/** What the agent process serves appContract.templates from (@taalcut/templates' service). */
export interface TemplatesService {
  list(query: TemplateListQuery): AsyncResult<TemplateListPage>;
  /** LRN1-TPL: TemplateSearch (words alone, `degraded: 'keyword-only'`, until the embedding space opens). */
  search?(query: TemplateSearchQuery): AsyncResult<TemplateSearchResult>;
  get(input: { readonly templateId: TemplateId; readonly version?: number }): AsyncResult<{
    readonly summary: TemplateSummary;
    readonly template: Template;
  }>;
  versions(templateId: TemplateId): AsyncResult<TemplateVersionSummary[]>;
  formats(): AsyncResult<FormatSummary[]>;
  folders?(): AsyncResult<TemplateFolder[]>;
  starters?(input: {
    readonly locale: AppLocale;
    readonly forLibrary: boolean;
  }): AsyncResult<StarterSummary[]>;
  exportDocument?(
    input: TemplateDocumentInput,
  ): AsyncResult<{ readonly fileName: string; readonly text: string }>;
  instagramStatus?(): AsyncResult<InstagramSavedStatus>;
  instagramCollections?(): AsyncResult<InstagramCollection[]>;
  instagramReels?(query: InstagramReelsQuery): AsyncResult<InstagramReelsPage>;
  styleProfile?(input: StyleProfileInput): AsyncResult<StyleProfileView>;
  writeStyleSummary?(input: StyleProfileInput): AsyncResult<StyleProfileView>;
  /** REF1: optional until @taalcut/templates serves it (core.not_implemented meanwhile). */
  fetchMedia?(input: TemplateFetchMediaInput): AsyncResult<TemplateSummary>;
  /** BRK1: served in the agent process with its model call (core.not_implemented until then). */
  proposeEdits?(input: TemplateProposeEditsInput, signal?: AbortSignal): AsyncResult<TemplateProposals>;
}

export function templatesRouter(service: TemplatesService) {
  const os = implementContract(templatesContract);
  return os.router({
    list: os.list.handler(async ({ input }) => unwrapRpc(await service.list(input))),
    search: os.search.handler(({ input }) =>
      callOptional('templates.search', service.search?.bind(service), input),
    ),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input))),
    versions: os.versions.handler(async ({ input }) => unwrapRpc(await service.versions(input.templateId))),
    formats: os.formats.handler(async () => unwrapRpc(await service.formats())),
    folders: os.folders.handler(() => callOptional('templates.folders', service.folders?.bind(service))),
    starters: os.starters.handler(({ input }) =>
      callOptional('templates.starters', service.starters?.bind(service), input),
    ),
    exportDocument: os.exportDocument.handler(({ input }) =>
      callOptional('templates.exportDocument', service.exportDocument?.bind(service), input),
    ),
    instagramStatus: os.instagramStatus.handler(() =>
      callOptional('templates.instagramStatus', service.instagramStatus?.bind(service)),
    ),
    instagramCollections: os.instagramCollections.handler(() =>
      callOptional('templates.instagramCollections', service.instagramCollections?.bind(service)),
    ),
    instagramReels: os.instagramReels.handler(({ input }) =>
      callOptional('templates.instagramReels', service.instagramReels?.bind(service), input),
    ),
    styleProfile: os.styleProfile.handler(({ input }) =>
      callOptional('templates.styleProfile', service.styleProfile?.bind(service), input),
    ),
    writeStyleSummary: os.writeStyleSummary.handler(({ input }) =>
      callOptional('templates.writeStyleSummary', service.writeStyleSummary?.bind(service), input),
    ),
    fetchMedia: os.fetchMedia.handler(({ input }) =>
      callOptional('templates.fetchMedia', service.fetchMedia?.bind(service), input),
    ),
    proposeEdits: os.proposeEdits.handler(({ input, signal }) =>
      callOptional('templates.proposeEdits', service.proposeEdits?.bind(service), input, signal),
    ),
  });
}
