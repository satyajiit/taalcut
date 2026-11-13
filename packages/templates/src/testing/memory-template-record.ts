// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The memory TemplateStore's records (P2-T8, P3-V14): a lineage and its versions, the summary and list row
 * read from them, and the JSON-safe snapshot that reopens the store. Each version keeps its stored JSON (what
 * `get` returns) and the parsed Template it came from, so reads never cast the JSON back.
 */
import {
  templateSchema,
  templateSummaryFacts,
  type CommandSource,
  type Template,
  type TemplateFolderId,
  type TemplateId,
  type TemplateMeta,
  type TemplateProvenance,
  type TemplateSummary,
  type TrendFreshness,
} from '@taalcut/core';
import type { QueryRow } from '../library/memory-template-query';

export interface StoredVersion {
  readonly version: number;
  readonly parentVersion: number | null;
  readonly schemaVersion: number;
  readonly json: unknown;
  readonly createdAt: number;
  readonly command: string | null;
  readonly source: CommandSource | null;
  readonly changeKey: string | null;
}

/** A stored version and the document it holds. */
export interface MemoryVersion extends StoredVersion {
  readonly template: Template;
}

interface LineageFields {
  readonly id: TemplateId;
  name: string;
  readonly projectId: TemplateMeta['projectId'];
  listed: boolean;
  archived: boolean;
  head: number;
  readonly createdAt: number;
  updatedAt: number;
  tags: string[];
  folderId: TemplateFolderId | null;
  favourite: boolean;
  trendFreshness: TrendFreshness | null;
  provenance: TemplateProvenance | null;
}

export interface Lineage extends LineageFields {
  readonly versions: Map<number, MemoryVersion>;
}

type SnapshotLineage = { readonly [K in keyof LineageFields]: LineageFields[K] } & {
  readonly versions: readonly StoredVersion[];
};

export interface MemoryTemplateSnapshot {
  readonly lineages: readonly SnapshotLineage[];
  readonly usage: readonly { readonly templateId: TemplateId; readonly timelines: number }[];
  readonly assets: readonly {
    readonly sha256: string;
    readonly bytes: readonly number[];
    readonly at: number;
  }[];
  readonly staleAfterDays: number;
}

export function jsonClone(value: unknown): unknown {
  const raw: unknown = JSON.parse(JSON.stringify(value));
  return raw;
}

/** A stored document read back as a Template: it was one when it was put, so a failure is a bug and throws. */
export function asTemplate(json: unknown): Template {
  return templateSchema.parse(json);
}

export function versionOf(
  template: Template,
  change: Omit<StoredVersion, 'json' | 'version' | 'parentVersion' | 'schemaVersion'>,
): MemoryVersion {
  return {
    version: template.version,
    parentVersion: template.parentVersion,
    schemaVersion: template.schemaVersion,
    json: jsonClone(template),
    template: structuredClone(template),
    ...change,
  };
}

export function newLineage(template: Template, meta: TemplateMeta, now: number): Lineage {
  return {
    id: template.id,
    name: meta.name,
    projectId: meta.projectId,
    listed: meta.listed,
    archived: false,
    head: 1,
    createdAt: now,
    updatedAt: now,
    tags: [],
    folderId: null,
    favourite: false,
    trendFreshness: meta.trendFreshness ?? null,
    provenance: meta.provenance ?? null,
    versions: new Map(),
  };
}

/** The head's document. The head always exists: every write that moves it checks the version first. */
export function headOf(lineage: Lineage): Template {
  const stored = lineage.versions.get(lineage.head);
  if (!stored) throw new Error(`missing template version ${lineage.head}`);
  return stored.template;
}

export function contactSheetsOf(lineage: Lineage): string[] {
  return [...lineage.versions.values()].flatMap((version) => {
    const asset = version.template.contactSheet?.asset;
    return asset ? [asset] : [];
  });
}

export function summaryOf(lineage: Lineage): TemplateSummary {
  const head = headOf(lineage);
  return {
    id: lineage.id,
    name: lineage.name,
    head: lineage.head,
    origin: head.origin.kind,
    platform: head.origin.kind === 'reference' ? head.origin.platform : null,
    duration: head.duration,
    slotCount: head.slots.length,
    bpm: head.beatMap?.bpm ?? null,
    projectId: lineage.projectId,
    listed: lineage.listed,
    archived: lineage.archived,
    ...templateSummaryFacts(head),
    tags: [...lineage.tags],
    folderId: lineage.folderId,
    favourite: lineage.favourite,
    trendFreshness: lineage.trendFreshness,
    provenance: lineage.provenance,
    createdAt: lineage.createdAt,
    updatedAt: lineage.updatedAt,
  };
}

export function searchText(name: string, tags: readonly string[], template: Template): string {
  const intents = template.slots.flatMap((slot) => [
    slot.intent.text,
    slot.intent.subject,
    slot.intent.place,
  ]);
  return [name, ...tags, ...intents, ...template.text.map((item) => item.text)]
    .filter((part) => part !== null && part !== '')
    .join(' ')
    .toLowerCase();
}

/** What `selectTemplates` filters and sorts a lineage by. */
export function queryRowOf(lineage: Lineage, used: number): QueryRow & { readonly lineage: Lineage } {
  const head = headOf(lineage);
  const facts = templateSummaryFacts(head);
  return {
    lineage,
    id: lineage.id,
    name: lineage.name,
    createdAt: lineage.createdAt,
    updatedAt: lineage.updatedAt,
    listed: lineage.listed,
    archived: lineage.archived,
    projectId: lineage.projectId,
    tags: lineage.tags,
    folderId: lineage.folderId,
    favourite: lineage.favourite,
    trendDate: lineage.trendFreshness?.date ?? null,
    used,
    origin: head.origin.kind,
    formatId: facts.formatId,
    language: facts.language,
    search: searchText(lineage.name, lineage.tags, head),
    fingerprints: [...lineage.versions.values()].flatMap(({ template }) =>
      template.origin.kind === 'reference' ? [template.origin.fingerprint] : [],
    ),
  };
}

export function snapshotLineage(lineage: Lineage): SnapshotLineage {
  const { versions, ...fields } = lineage;
  return {
    ...fields,
    tags: [...fields.tags],
    versions: [...versions.values()].map((version) => ({
      version: version.version,
      parentVersion: version.parentVersion,
      schemaVersion: version.schemaVersion,
      json: jsonClone(version.json),
      createdAt: version.createdAt,
      command: version.command,
      source: version.source,
      changeKey: version.changeKey,
    })),
  };
}

export function restoreLineage(row: SnapshotLineage): Lineage {
  const versions = new Map(
    row.versions.map((version) => [version.version, { ...version, template: asTemplate(version.json) }]),
  );
  return { ...row, tags: [...row.tags], versions };
}
