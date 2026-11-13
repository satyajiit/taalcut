// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns one kNN over the active embedding space into ranked shot lists, one
 * per item kind (vision SPEC, "What gets embedded"): `frame:<shotId>:<n>`,
 * `description:<shotId>` and `ocr:<shotId>:<n>` name their shot;
 * `transcript:<assetId>:<segment>` is credited by the fusion's
 * `transcriptCredit`, to the shot holding the segment's start or to every
 * shot the segment overlaps (its range read from the stored transcript in
 * SQL, so a long transcript is never parsed whole). Each entry carries the
 * item's similarity to the query; a shot keeps its best item per list. An item
 * whose shot is no longer in the library (a vector a re-detection left behind,
 * IX2-F3) takes no place in any list.
 */
import {
  RationalTime,
  TimeRange,
  timeRangeSchema,
  type AssetId,
  type ShotId,
  type VectorMatch,
  type VectorMetric,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createShotRepository, shotRange } from '../repositories/shots';
import { onePerShot, type ListMatch } from './fusion/lists';
import type { TranscriptCredit, VectorList } from './fusion/versions';

export type { VectorList };

/** The shot an item id names directly, or null for transcripts and unknown ids. */
export function shotOfItem(
  id: string,
): { kind: VectorList; shotId?: ShotId; assetId?: AssetId; segment?: number } | null {
  const [kind, owner, index] = id.split(':');
  if (!owner) return null;
  if (kind === 'frame' || kind === 'ocr' || kind === 'description') return { kind, shotId: owner as ShotId };
  if (kind === 'transcript' && index !== undefined && /^\d+$/.test(index))
    return { kind, assetId: owner as AssetId, segment: Number(index) };
  return null;
}

/** Similarity from the index's distance: cosine distance is 1 − cos; L2 between unit vectors is √(2 − 2cos). */
export function similarityOf(distance: number, metric: VectorMetric): number {
  return metric === 'cosine' ? 1 - distance : 1 - (distance * distance) / 2;
}

/** Resolves transcript segments to shots, caching each asset's shots for one search. */
function transcriptCredit(db: LibraryDatabase, mode: TranscriptCredit) {
  const shots = createShotRepository(db);
  const byAsset = new Map<AssetId, { id: ShotId; range: TimeRange }[]>();
  const segment = db.driver.prepare(
    `SELECT json_extract(transcript, '$.segments[' || ? || '].range') AS range
     FROM transcripts WHERE asset_id = ?`,
  );
  const rangeOf = (assetId: AssetId, index: number): TimeRange | null => {
    const raw = segment.get(index, assetId)?.range;
    if (typeof raw !== 'string') return null;
    const parsed = timeRangeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  };
  return (assetId: AssetId, index: number): ShotId[] => {
    let list = byAsset.get(assetId);
    if (!list) {
      list = shots.listByAsset(assetId).map((shot) => ({ id: shot.id, range: shotRange(shot) }));
      byAsset.set(assetId, list);
    }
    const first = list[0];
    const range = first ? rangeOf(assetId, index) : null;
    if (!first || !range) return [];
    if (mode === 'overlap') {
      const overlapping = list.filter((s) => TimeRange.overlaps(s.range, range));
      if (overlapping.length > 0) return overlapping.map((s) => s.id);
    }
    const holding = list.find((s) => TimeRange.contains(s.range, range.start));
    if (holding) return [holding.id];
    // Between or after the shots: the last shot starting before the segment, else the first.
    const before = list.filter((s) => RationalTime.compare(s.range.start, range.start) <= 0).at(-1);
    return [(before ?? first).id];
  };
}

/** Which of `ids` name a shot the library has. */
function existingShots(db: LibraryDatabase, ids: readonly ShotId[]): ReadonlySet<string> {
  if (ids.length === 0) return new Set();
  const rows = db.driver
    .prepare('SELECT id FROM shots WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify([...new Set(ids)]));
  return new Set(rows.map((row) => String(row.id)));
}

/** The kNN's matches (nearest first) as ranked shot lists per kind, each shot once at its best similarity. */
export function vectorLists(
  db: LibraryDatabase,
  matches: readonly VectorMatch[],
  options: { readonly metric: VectorMetric; readonly transcriptCredit: TranscriptCredit },
): Record<VectorList, ListMatch[]> {
  const lists: Record<VectorList, ListMatch[]> = { frame: [], description: [], transcript: [], ocr: [] };
  const credit = transcriptCredit(db, options.transcriptCredit);
  const items = matches.flatMap((match) => {
    const item = shotOfItem(match.id);
    return item ? [{ match, item }] : [];
  });
  const present = existingShots(
    db,
    items.flatMap(({ item }) => (item.shotId ? [item.shotId] : [])),
  );
  for (const { match, item } of items) {
    if (item.shotId && !present.has(item.shotId)) continue;
    const similarity = similarityOf(match.distance, options.metric);
    const shotIds = item.shotId
      ? [item.shotId]
      : item.assetId !== undefined && item.segment !== undefined
        ? credit(item.assetId, item.segment)
        : [];
    for (const shotId of shotIds) lists[item.kind].push({ shotId, similarity });
  }
  return {
    frame: onePerShot(lists.frame),
    description: onePerShot(lists.description),
    transcript: onePerShot(lists.transcript),
    ocr: onePerShot(lists.ocr),
  };
}
