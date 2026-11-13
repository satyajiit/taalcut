// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The phone import's files that couldn't be read, as real clips of the import (requests-import-to-clip.md 1): two of
 * its earlier clips stop at the first step after copying, each with the library's reason, so the import strip's
 * "2 files couldn't be read", the failed filter and each clip's page all tell the same story.
 */
import type { FakeAsset } from './assets';
import { FAKE_STAGES, type FakeStage } from './stages';

/** Why each one stopped (the library's error keys; indexing-messages.ts words them). */
const REASONS = [
  { code: 'media.probe_failed', messageKey: 'errors.media.probe_failed' },
  { code: 'media.unsupported_media', messageKey: 'errors.media.unsupported_media' },
] as const;

/** Which of the import's clips, oldest first: early in the import, away from the grid's first rows. */
const AT = [10, 11];

/** Marks the import's unreadable files in place; returns them (empty when there is no import). */
export function markImportFailures(assets: FakeAsset[], sourceId: string | undefined): FakeAsset[] {
  if (!sourceId) return [];
  const tail = assets.filter(
    (asset) => asset.summary.index.state === 'indexing' && asset.summary.sourceIds[0] === sourceId,
  );
  const marked: FakeAsset[] = [];
  AT.forEach((at, i) => {
    const asset = tail[at];
    const reason = REASONS[i];
    if (!asset || !reason) return;
    const failed: FakeAsset = {
      summary: {
        ...asset.summary,
        index: { state: 'failed', done: 1, total: asset.summary.index.total, searchableAt: null },
        thumbnail: null,
        description: null,
        quality: null,
        shotCount: 0,
        language: null,
      },
      extras: { ...asset.extras, failure: { ...reason, retryable: false } },
    };
    assets[asset.extras.n] = failed;
    marked.push(failed);
  });
  return marked;
}

/**
 * The import's failed clips, as the library counts them (status.ts counts every clip located in the source): its
 * unreadable files and any older clip of the source whose analysis stopped, so the strip's counts are what its failed
 * filter lists (UX1-IMPORT). A removed clip leaves the count.
 */
export function sourceFailures(assets: readonly FakeAsset[], sourceId: string | undefined): FakeAsset[] {
  if (!sourceId) return [];
  return assets.filter(
    (asset) =>
      asset.summary.sourceIds[0] === sourceId &&
      asset.summary.index.state === 'failed' &&
      !asset.summary.trashed,
  );
}

/** How many of `failed` stopped at `stage`: detail.ts fails each clip at its `index.done`th step. */
export function failedAt(failed: readonly FakeAsset[], stage: FakeStage): number {
  return failed.filter((asset) => FAKE_STAGES[asset.summary.index.done] === stage).length;
}
