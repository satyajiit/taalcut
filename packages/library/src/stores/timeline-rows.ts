// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timeline rows ↔ core's TimelineSummary: the summary columns a stored
 * document fills (duration, clips, template, cast), the assets its clips
 * use, the Style it names (for StyleStore.usedBy), and the hash versions
 * compare.
 */
import {
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type AssetId,
  type Result,
  type Timeline,
  type TimelineSummary,
} from '@taalcut/core';
import { err, ok, ValidationError } from '@taalcut/core';
import type { timelines } from '../schema/projects';
import { canonicalJson, sha256Hex } from './canonical';

export type TimelineRow = typeof timelines.$inferSelect;
type DocumentColumns = Omit<TimelineRow, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>;

export function validTimeline(timeline: Timeline): Result<Timeline> {
  const parsed = timelineSchema.safeParse(timeline);
  return parsed.success
    ? ok(timeline)
    : err(ValidationError({ field: 'timeline' }, { detail: parsed.error.message.slice(0, 2000) }));
}

/** V1's length: its clips and gaps end to end (transitions overlap their neighbours, as in OTIO). */
function duration(timeline: Timeline): RationalTime {
  const video = timeline.tracks.find((track) => track.kind === 'video');
  let total = RationalTime.zero(timeline.canvas.rate);
  for (const item of video?.items ?? []) {
    if (item.type === 'clip' || item.type === 'gap' || item.type === 'program')
      total = RationalTime.add(total, item.duration);
  }
  return total;
}

/** The summary columns of a document stored at `revision`; the document itself carries that revision. */
export function documentColumns(timeline: Timeline, revision: number): DocumentColumns {
  const video = timeline.tracks.find((track) => track.kind === 'video');
  const length = duration(timeline);
  return {
    name: timeline.name.normalize('NFC'),
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    document: { ...timeline, revision },
    revision,
    templateId: timeline.template?.id ?? null,
    templateVersion: timeline.template?.version ?? null,
    castId: timeline.cast?.castId ?? null,
    variantIndex: timeline.cast?.variantIndex ?? null,
    styleId: timeline.styleId,
    clipCount: (video?.items ?? []).filter((item) => item.type === 'clip' || item.type === 'program').length,
    durationValue: length.value,
    durationRateNum: length.rate.num,
    durationRateDen: length.rate.den,
  };
}

export function toTimelineSummary(row: TimelineRow): TimelineSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    revision: row.revision,
    duration: { value: row.durationValue, rate: { num: row.durationRateNum, den: row.durationRateDen } },
    clipCount: row.clipCount,
    template:
      row.templateId !== null && row.templateVersion !== null
        ? { id: row.templateId, version: row.templateVersion }
        : null,
    castId: row.castId,
    variantIndex: row.variantIndex,
    updatedAt: row.updatedAt,
  };
}

/** Every asset a clip on any track refers to. */
export function mediaAssets(document: unknown): AssetId[] {
  const tracks = (document as Partial<Timeline>).tracks ?? [];
  const ids = new Set<AssetId>();
  for (const track of tracks) {
    if (track.kind === 'text') continue;
    for (const item of track.items) if (item.type === 'clip') ids.add(item.media.assetId);
  }
  for (const cover of (document as Partial<Timeline>).covers ?? [])
    if (cover.source.kind === 'asset') ids.add(cover.source.assetId);
  for (const program of (document as Partial<Timeline>).authoredPrograms ?? [])
    for (const assetId of program.assetIds) ids.add(assetId);
  return [...ids];
}

/**
 * What a version compares: the document without `revision` and `updatedAt`, which change on every write.
 * So a restored document equals the version it came from, and an unchanged working copy isn't saved twice.
 */
export function documentHash(document: unknown): string {
  const { revision: _revision, updatedAt: _updatedAt, ...content } = document as Record<string, unknown>;
  return sha256Hex(canonicalJson(content));
}
