// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A generated file's exact words (core GeneratedFile.transcript, round P3-3): a voice line's transcript built
 * from the provider's character timings (engine `tts`). The sink stores it as the asset's transcript, generation
 * 0, with its language, in the same transaction as the asset; indexing then skips the speech stages for the
 * asset (indexing/provided-transcript.ts), so captions, search, ducking and the Voice director's coverage read
 * the generator's words. The same bytes handed in again keep the words they have unless those were recognised.
 */
import { ok, type AssetId, type Result, type Transcript } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createAssetRepository } from '../repositories/media-library';
import { createTranscriptRepository } from '../repositories/transcripts';

export function keepTranscript(
  db: LibraryDatabase,
  assetId: AssetId,
  transcript: Transcript | undefined,
): Result<void> {
  if (!transcript) return ok(undefined);
  const transcripts = createTranscriptRepository(db);
  if (transcripts.get(assetId)?.engine === 'tts') return ok(undefined);
  const stored = transcripts.put(assetId, transcript, 0);
  if (!stored.ok || transcript.language === 'und') return stored;
  const language = createAssetRepository(db).setLanguage(assetId, transcript.language);
  return language.ok ? ok(undefined) : language;
}
