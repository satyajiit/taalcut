// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template rows ↔ core's summaries: what a version stores about its
 * document (summary columns, the head facts a list filters on, the contact
 * sheet it uses), the lineage's library metadata (P3-V14) and what the
 * full-text index holds for a lineage's head.
 */
import {
  TEMPLATE_SCHEMA_VERSION,
  templateProvenanceSchema,
  templateSummaryFacts,
  type Template,
  type TemplateMedia,
  type TemplateSummary,
  type TemplateVersionSummary,
} from '@taalcut/core';
import type { templates, templateVersions } from '../schema/templates';
import { templateNameKey } from './template-name-key';

export type TemplateRow = typeof templates.$inferSelect;
export type TemplateVersionRow = typeof templateVersions.$inferSelect;
export type VersionColumns = Omit<
  TemplateVersionRow,
  'templateId' | 'version' | 'parentVersion' | 'changeKey' | 'command' | 'source' | 'createdAt'
>;
/** What a summary reads of the head version. */
export type HeadColumns = Omit<VersionColumns, 'schemaVersion' | 'document' | 'fingerprint'>;

/** The summary columns a version keeps, read from its document. */
export function versionColumns(template: Template): VersionColumns {
  const { origin } = template;
  const facts = templateSummaryFacts(template);
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    document: template,
    origin: origin.kind,
    platform: origin.kind === 'reference' ? origin.platform : null,
    fingerprint: origin.kind === 'reference' ? origin.fingerprint : null,
    durationValue: template.duration.value,
    durationRateNum: template.duration.rate.num,
    durationRateDen: template.duration.rate.den,
    slotCount: template.slots.length,
    bpm: template.beatMap?.bpm ?? null,
    contactSheet: template.contactSheet?.asset ?? null,
    formatId: facts.formatId,
    language: facts.language,
    styleId: facts.styleId,
    approvedSlots: facts.approvedSlots,
    slotStrip: facts.slotStrip,
  };
}

/** A new lineage's row: version 1 is its head, with the provenance and trend date it was made with. */
export function newLineageRow(
  fields: Pick<
    TemplateRow,
    'id' | 'name' | 'projectId' | 'listed' | 'provenance' | 'trendDate' | 'trendSource' | 'createdAt'
  >,
): TemplateRow {
  return {
    id: fields.id,
    name: fields.name,
    nameKey: templateNameKey(fields.name),
    projectId: fields.projectId,
    listed: fields.listed,
    headVersion: 1,
    archivedAt: null,
    createdAt: fields.createdAt,
    updatedAt: fields.createdAt,
    tags: [],
    folderId: null,
    favourite: false,
    trendDate: fields.trendDate,
    trendSource: fields.trendSource,
    provenance: fields.provenance,
  };
}

/** The lineage's library metadata (P3-V14). A stored provenance that no longer parses reads as none. */
export function libraryFields(
  row: Pick<TemplateRow, 'tags' | 'folderId' | 'favourite' | 'trendDate' | 'trendSource' | 'provenance'>,
): Pick<TemplateSummary, 'tags' | 'folderId' | 'favourite' | 'trendFreshness' | 'provenance'> {
  // Written through templateProvenanceSchema; only a hand-edited database fails it, and none is shown then.
  const provenance = row.provenance === null ? null : templateProvenanceSchema.safeParse(row.provenance);
  return {
    tags: [...row.tags],
    folderId: row.folderId,
    favourite: row.favourite,
    trendFreshness:
      row.trendDate !== null && row.trendSource !== null
        ? { date: row.trendDate, source: row.trendSource }
        : null,
    provenance: provenance?.success ? provenance.data : null,
  };
}

/**
 * The summary of a lineage at its head. The contact sheet's grid is read from the head's stored document unless
 * the caller read it already (a list reads it with SQL). `media` is the template's kept reel (REF1), null without.
 */
export function toSummary(
  row: TemplateRow,
  head: HeadColumns & { readonly document?: unknown },
  sheet: TemplateSummary['contactSheet'] = templateSummaryFacts((head.document ?? {}) as Partial<Template>)
    .contactSheet,
  media: TemplateMedia | null = null,
): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    head: row.headVersion,
    origin: head.origin,
    platform: (head.platform as TemplateSummary['platform']) ?? null,
    duration: { value: head.durationValue, rate: { num: head.durationRateNum, den: head.durationRateDen } },
    slotCount: head.slotCount,
    bpm: head.bpm,
    projectId: row.projectId,
    listed: row.listed,
    archived: row.archivedAt !== null,
    contactSheet: head.contactSheet ? sheet : null,
    approvedSlots: head.approvedSlots,
    slotStrip: [...head.slotStrip],
    formatId: head.formatId,
    language: head.language,
    styleId: head.styleId,
    ...libraryFields(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    media,
  };
}

export function toVersionSummary(row: TemplateVersionRow, headVersion: number): TemplateVersionSummary {
  return {
    version: row.version,
    parentVersion: row.parentVersion,
    createdAt: row.createdAt,
    command: row.command,
    source: row.source,
    isHead: row.version === headVersion,
  };
}

/** What `template_fts` holds for a lineage's head: its name, slot intents, overlay text and tags. */
export function ftsColumns(
  name: string,
  document: unknown,
  tags: readonly string[],
): { intents: string; overlays: string; tags: string } {
  const template = document as Partial<Template>;
  const intents = (template.slots ?? []).flatMap((slot) => [
    slot.name ?? '',
    slot.intent?.text ?? '',
    slot.intent?.subject ?? '',
    slot.intent?.place ?? '',
  ]);
  const overlays = (template.text ?? []).map((overlay) => overlay.text);
  return {
    intents: intents.filter(Boolean).join('\n').normalize('NFC'),
    overlays: overlays.join('\n').normalize('NFC'),
    tags: tags.join(' '),
  };
}
