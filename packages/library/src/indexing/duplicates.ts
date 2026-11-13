// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Near-duplicate grouping across the library (G25): not a per-asset stage
 * but one pass over every analysed shot, run through the `duplicates`
 * definition (vision's `vision.groupDuplicates`) once analyses settle. Its
 * groups replace the library's (`duplicate_group`, `best_take`). The job's
 * idempotency key is a hash of what it sees, so an unchanged library isn't
 * grouped twice.
 */
import { createHash } from 'node:crypto';
import {
  err,
  ok,
  toTaalcutError,
  type AssetId,
  type DuplicatePassDefinition,
  type DuplicateShotView,
  type JobRequest,
  type Result,
  type ShotId,
  type SourceId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createShotRepository, shotAnalysis, shotRange, type Shot } from '../repositories/shots';
import { shots as shotTable } from '../schema/library';
import { isNotNull } from 'drizzle-orm';

/** Every analysed shot of an asset that is in the library (not trashed, with a location). */
export function duplicateShotViews(db: LibraryDatabase): DuplicateShotView[] {
  const owners = new Map(
    (
      db.driver
        .prepare(
          `SELECT a.id AS id, a.capture_time AS captured,
             (SELECT source_id FROM asset_locations l WHERE l.asset_id = a.id ORDER BY l.storage, l.id LIMIT 1)
               AS source
           FROM assets a WHERE a.trashed_at IS NULL AND a.detached_at IS NULL`,
        )
        .all() as { id: AssetId; captured: number | null; source: SourceId | null }[]
    ).map((r) => [r.id, r]),
  );
  const views: DuplicateShotView[] = [];
  const rows: Shot[] = db.orm.select().from(shotTable).where(isNotNull(shotTable.dHash)).all();
  for (const shot of rows) {
    const owner = owners.get(shot.assetId);
    const analysis = shotAnalysis(shot);
    if (!owner?.source || !analysis) continue;
    views.push({
      shotId: shot.id,
      assetId: shot.assetId,
      sourceId: owner.source,
      capturedAt: owner.captured,
      range: shotRange(shot),
      analysis,
    });
  }
  return views.sort((a, b) => a.shotId.localeCompare(b.shotId));
}

/** The job request for a pass over `views`, or null when there is nothing to compare. */
export function duplicatePassRequest(
  definition: DuplicatePassDefinition,
  views: readonly DuplicateShotView[],
): Result<JobRequest | null> {
  if (views.length < 2) return ok(null);
  try {
    const job = definition.job(views);
    const key = createHash('sha256')
      .update(views.map((v) => `${v.shotId}:${v.analysis.dHash}`).join('\n'))
      .digest('hex');
    return ok({
      kind: job.kind.kind,
      input: job.input,
      priority: job.priority ?? 'low',
      idempotencyKey: `duplicates:${key}`,
    });
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

/** Stores the pass's groups (replacing the library's). */
export function applyDuplicateGroups(
  db: LibraryDatabase,
  definition: DuplicatePassDefinition,
  output: unknown,
): Result<number> {
  let groups;
  try {
    groups = definition.groups(output);
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
  if (!groups.ok) return groups;
  // Shots deleted since the pass started can't lead or join a group.
  const repo = createShotRepository(db);
  const known = new Set(repo.getMany(groups.value.flatMap((g) => g.shotIds)).map((s) => s.id));
  const kept = groups.value
    .map((g) => ({ ...g, shotIds: g.shotIds.filter((id: ShotId) => known.has(id)) }))
    .filter((g) => g.shotIds.length > 1 && g.shotIds.includes(g.bestShotId));
  return repo.setDuplicateGroups(kept);
}
