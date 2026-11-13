// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Applies a batch of file plans in one transaction (P2-L2). Each plan is
 * re-checked against the rows as they are now, since another scan may have
 * changed them while this one hashed.
 */
import { basename } from 'node:path';
import type { AssetId, SourceId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { assetKindOf, type FilePlan } from './scan-plan';
import {
  absolutePathOf,
  dropLocation,
  insertAssetWithLocation,
  insertLocation,
  locationAt,
  markMissing,
  retargetLocation,
  sourceExists,
  touchLocation,
  type NewLocation,
} from './scan-store';

export interface ScanTally {
  seen: number;
  added: number;
  moved: number;
  missing: number;
  placeholders: number;
  unchanged: number;
  failed: number;
}

export function emptyTally(): ScanTally {
  return { seen: 0, added: 0, moved: 0, missing: 0, placeholders: 0, unchanged: 0, failed: 0 };
}

export interface ApplyTarget {
  readonly sourceId: SourceId;
  readonly rootPath: string;
  readonly volumeUuid: string | null;
  /** 'watcher' when a watcher event asked for the scan. */
  readonly via: 'scan' | 'watcher';
}

export interface AppliedBatch {
  /** The source was removed while the scan ran: nothing was written. */
  readonly sourceRemoved: boolean;
  readonly created: AssetId[];
  readonly updated: AssetId[];
}

type Planned = { readonly relativePath: string; readonly plan: FilePlan };

export function applyBatch(
  db: LibraryDatabase,
  target: ApplyTarget,
  batch: readonly Planned[],
  tally: ScanTally,
): AppliedBatch {
  const created: AssetId[] = [];
  const updated: AssetId[] = [];
  const removed = db.transaction(() => {
    if (!sourceExists(db, target.sourceId)) return true;
    const now = db.clock();
    for (const item of batch) {
      try {
        // A savepoint per file: one file another writer got to first doesn't undo the batch.
        db.transaction(() => applyOne(item));
      } catch (cause) {
        if (!db.driver.describeError(cause)) throw cause;
        tally.failed += 1;
      }
    }
    return false;

    function applyOne({ relativePath, plan }: Planned): void {
      const place = (file: NewLocation['file'], partialHash: string | null, fullHash?: string | null) => ({
        sourceId: target.sourceId,
        relativePath,
        absolutePath: absolutePathOf(target.rootPath, relativePath),
        volumeUuid: target.volumeUuid,
        file,
        partialHash,
        ...(fullHash !== undefined ? { fullHash } : {}),
        state: 'present' as const,
        via: target.via,
      });
      if (plan.kind !== 'gone') tally.seen += 1;
      switch (plan.kind) {
        case 'gone': {
          const here = locationAt(db, target.sourceId, relativePath);
          if (here) tally.missing += markMissing(db, [here.id], now);
          break;
        }
        case 'failed':
          tally.failed += 1;
          break;
        case 'placeholder': {
          tally.placeholders += 1;
          const loc = { ...place(plan.file, null), state: 'icloud_placeholder' as const };
          if (plan.existing) {
            touchLocation(db, plan.existing.id, { file: plan.file, state: 'icloud_placeholder' }, now);
            updated.push(plan.existing.assetId);
          } else {
            const kind = assetKindOf(basename(relativePath));
            if (kind)
              created.push(
                insertAssetWithLocation(db, { ...loc, kind, fileName: basename(relativePath) }, now),
              );
          }
          break;
        }
        case 'unchanged':
        case 'touched':
          tally.unchanged += 1;
          touchLocation(
            db,
            plan.existing.id,
            {
              file: plan.file,
              state: 'present',
              ...(plan.kind === 'touched' ? { partialHash: plan.partialHash } : {}),
            },
            now,
          );
          if (plan.existing.state !== 'present') updated.push(plan.existing.assetId);
          break;
        default: {
          if (plan.replaces) dropLocation(db, plan.replaces, now);
          if (plan.kind === 'relink') {
            retargetLocation(db, plan.candidate.location.id, place(plan.file, plan.partialHash), now);
            updated.push(plan.candidate.location.assetId);
            tally.moved += 1;
          } else if (plan.kind === 'attach') {
            insertLocation(db, plan.assetId, place(plan.file, plan.partialHash), now);
            updated.push(plan.assetId);
            tally.moved += 1;
          } else {
            const kind = assetKindOf(basename(relativePath))!;
            const location = place(plan.file, plan.partialHash, plan.fullHash);
            created.push(
              insertAssetWithLocation(db, { ...location, kind, fileName: basename(relativePath) }, now),
            );
            tally.added += 1;
          }
        }
      }
    }
  });
  return { sourceRemoved: removed, created, updated };
}
