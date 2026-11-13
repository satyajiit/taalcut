// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An asset's transcript (P2-L1): core's Transcript with word timings as JSON,
 * plus its plain text for search and previews. Storing one also fills each
 * shot's `transcript_text` (the speech inside its range) in the same
 * transaction, so keyword search sees speech per shot.
 */
import {
  err,
  ok,
  transcriptSchema,
  ValidationError,
  type AssetId,
  type Result,
  type SpokenLanguage,
  type Transcript,
  type TranscriptSegment,
} from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { shots } from '../schema/library';
import { transcripts } from '../schema/media';
import { inTransaction } from './shared';
import { shotRange } from './shots';
import { speechIn, storedTranscript } from './transcript-text';

export interface TranscriptPage {
  readonly language: SpokenLanguage;
  readonly segments: TranscriptSegment[];
  readonly nextSegment?: number;
}

export interface TranscriptRepository {
  /** Stores the transcript for `generation` (null: the asset has no speech, so any old one goes). */
  put(assetId: AssetId, transcript: Transcript | null, generation: number): Result<void>;
  /** Null when the asset has no transcript (or it no longer parses). */
  get(assetId: AssetId): Transcript | null;
  /** Segments with word timings from `fromSegment`; null without a transcript. */
  page(assetId: AssetId, fromSegment: number, limit: number): TranscriptPage | null;
}

/** The plain text: segments in order, one per line. */
export function transcriptPlainText(transcript: Transcript): string {
  return transcript.segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n')
    .normalize('NFC');
}

export function createTranscriptRepository(db: LibraryDatabase): TranscriptRepository {
  const { orm } = db;

  /** Re-derives every shot's speech from `transcript` (or clears it). */
  function fillShots(assetId: AssetId, transcript: Transcript | null) {
    for (const shot of orm.select().from(shots).where(eq(shots.assetId, assetId)).all()) {
      const text = transcript ? speechIn(transcript, shotRange(shot)) : null;
      if (text !== shot.transcriptText)
        orm.update(shots).set({ transcriptText: text }).where(eq(shots.id, shot.id)).run();
    }
  }

  return {
    put(assetId, transcript, generation) {
      if (!Number.isSafeInteger(generation) || generation < 0)
        return err(ValidationError({ field: 'generation' }));
      let parsed: Transcript | null = null;
      if (transcript) {
        const checked = transcriptSchema.safeParse(transcript);
        if (!checked.success)
          return err(ValidationError({ field: 'transcript' }, { detail: checked.error.message }));
        parsed = checked.data;
      }
      return inTransaction(db, 'transcript', () => {
        orm.delete(transcripts).where(eq(transcripts.assetId, assetId)).run();
        if (parsed) {
          orm
            .insert(transcripts)
            .values({
              assetId,
              transcript: parsed as unknown,
              // The transcriber's own guess, kept as it said it. Readers get the clip's settled language
              // instead (storedTranscript, LIB1-LANG); nothing reads this column.
              language: parsed.language,
              engine: parsed.engine,
              local: parsed.local,
              text: transcriptPlainText(parsed),
              generation,
              createdAt: db.clock(),
            })
            .run();
        }
        fillShots(assetId, parsed);
        return ok(undefined);
      });
    },
    get: (assetId) => storedTranscript(db, assetId),
    page(assetId, fromSegment, limit) {
      const transcript = storedTranscript(db, assetId);
      if (!transcript) return null;
      const from = Math.max(0, Math.floor(fromSegment));
      const segments = transcript.segments.slice(from, from + Math.max(1, Math.floor(limit)));
      const next = from + segments.length;
      return {
        language: transcript.language,
        segments,
        ...(next < transcript.segments.length ? { nextSegment: next } : {}),
      };
    },
  };
}
