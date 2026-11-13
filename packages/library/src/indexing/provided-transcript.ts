// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Speech the generator provided (core GeneratedFile.transcript, round P3-3): a voice line's exact words, engine
 * `tts`, which the generated-asset sink stored as the asset's transcript. Recognising them again could only make
 * them worse, so the speech stages (language id, then transcription; audio's index stages, named as in the SPEC's
 * stage table) don't run for that asset: the pipeline's speech stage definitions answer this skip reason first,
 * so it holds at every new definition version and after a re-index too.
 */
import type { AssetId, IndexStageDefinition } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';

const SPEECH_STAGES: ReadonlySet<string> = new Set(['audio.language', 'audio.transcript']);

/** The skip reason (an i18n key, like audio's `indexing.skip.*`). */
export const TRANSCRIPT_PROVIDED = 'indexing.skip.transcriptProvided';

/** The reason to skip `stage` for this asset, or undefined when it runs as usual. */
export function providedSkip(db: LibraryDatabase, stage: string, assetId: AssetId): string | undefined {
  if (!SPEECH_STAGES.has(stage)) return undefined;
  const provided = db.driver
    .prepare("SELECT 1 AS hit FROM transcripts WHERE asset_id = ? AND engine = 'tts' LIMIT 1")
    .get(assetId);
  return provided === undefined ? undefined : TRANSCRIPT_PROVIDED;
}

/** The stage as the pipeline runs it: a speech stage answers the skip first for an asset with provided words. */
export function skippingProvidedSpeech(
  db: LibraryDatabase,
  definition: IndexStageDefinition,
): IndexStageDefinition {
  if (!SPEECH_STAGES.has(definition.stage)) return definition;
  return {
    ...definition,
    job: (view) => {
      const skip = providedSkip(db, definition.stage, view.assetId);
      return skip ? { skip } : definition.job(view);
    },
    result: (output, view) => definition.result(output, view),
  };
}
