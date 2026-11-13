// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip page's sound lane (UX2): the asset's waveform file, read in brief through a port the composition root
 * gives (it can reach the media cache; the library only knows the file's key).
 */
import {
  ok,
  type AssetDetail,
  type AsyncResult,
  type DerivedFileRef,
  type Result,
  type WaveformSummary,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createDerivedFileRepository } from '../repositories/derived-files';
import type { StoredAssetDetail } from './asset-detail';

export type WaveformReader = (ref: DerivedFileRef) => Promise<WaveformSummary | null>;

/**
 * The detail with its `waveform`: null when the clip has no waveform file (no sound, or media.previews hasn't run)
 * or the reader couldn't read it (the media cache let it go).
 */
export async function withWaveform(
  db: LibraryDatabase,
  detail: Result<StoredAssetDetail>,
  read: WaveformReader,
): AsyncResult<AssetDetail> {
  if (!detail.ok) return detail;
  const ref = createDerivedFileRepository(db).find(detail.value.asset.id, 'waveform');
  return ok({ ...detail.value, waveform: ref ? await read(ref) : null });
}
