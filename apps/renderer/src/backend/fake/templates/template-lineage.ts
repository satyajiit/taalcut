// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One template in the fake's library: its immutable versions, the head, its library facts and (REF1) the reel it
 * keeps, and the summary `templates.list` and `templates.get` answer with. The kept reel belongs to the template,
 * not a version, as the library's template media store keeps it.
 */
import {
  NO_TEMPLATE_LIBRARY_META,
  RationalTime,
  templateSummaryFacts,
  type CommandSource,
  type Template,
  type TemplateMedia,
  type TemplateSummary,
} from '@taalcut/core';
import type { LibraryMeta } from './template-seed-library';

export interface Lineage {
  /** The name in the library (a plan's, a hub fork's, an import's). */
  name: string;
  /** P3-V14's library facts (tags, folder, favourite, trend date, provenance, archived); absent: none yet. */
  meta: Partial<LibraryMeta>;
  /** Timelines made from it. */
  used: number;
  versions: { template: Template; command: string | null; source: CommandSource | null }[];
  head: number;
  updatedAt: number;
  /** REF1: the reel's video and music kept on this Mac; absent: none (made before REF1, or not from a reel). */
  media?: TemplateMedia | null;
}

export const headOf = (lineage: Lineage) => lineage.versions[lineage.head - 1]!.template;

export function summary(lineage: Lineage): TemplateSummary {
  const head = headOf(lineage);
  return {
    id: head.id,
    name: lineage.name,
    head: lineage.head,
    origin: head.origin.kind,
    platform: head.origin.kind === 'reference' ? head.origin.platform : null,
    duration: head.duration,
    slotCount: head.slots.length,
    bpm: head.beatMap?.bpm ?? null,
    projectId: null,
    listed: lineage.meta.listed ?? true,
    archived: lineage.meta.archived ?? false,
    ...templateSummaryFacts(head),
    tags: lineage.meta.tags ?? NO_TEMPLATE_LIBRARY_META.tags,
    folderId: lineage.meta.folderId ?? null,
    favourite: lineage.meta.favourite ?? false,
    trendFreshness: lineage.meta.trendFreshness ?? null,
    provenance: lineage.meta.provenance ?? null,
    createdAt: lineage.versions[0]!.template.createdAt,
    updatedAt: lineage.updatedAt,
    media: lineage.media ?? null,
  };
}

/** The link a template's reel came from, or null (a file, a format, a starter): what `templates.fetchMedia` needs. */
export function originLink(template: Template): string | null {
  return template.origin.kind === 'reference' ? template.origin.url : null;
}

/**
 * A kept reel for `template` as the template media store measures it: `reference.mp4` at about 2 Mbit/s (720p at
 * most, as the fetcher asks), its sound kept, a sha256 made from the id so it never changes between runs.
 */
export function keptMedia(
  template: Template,
  keptAt: number,
  source: TemplateMedia['source'] = 'anonymous',
): TemplateMedia {
  const seconds = RationalTime.toSeconds(template.duration);
  const hex = [...template.id].map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return {
    file: 'reference.mp4',
    bytes: Math.max(1, Math.round(seconds * 262_144)),
    durationMs: Math.max(1, Math.round(seconds * 1000)),
    sha256: hex.repeat(2).slice(0, 64).padEnd(64, '0'),
    hasAudio: true,
    source,
    keptAt,
  };
}
