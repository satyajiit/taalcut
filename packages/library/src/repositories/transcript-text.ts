// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The speech inside a shot's range (`shots.transcript_text`): the words whose
 * start falls in the range, or, for a segment without word timings, the
 * segment when its start does. Kept here so shots and transcripts share it
 * without importing each other.
 */
import { transcriptSchema, TimeRange, type AssetId, type Transcript } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { parseJsonText } from '../db/json-text';
import { settledTranscript } from '../speech/asset-language';

/** The transcript's text inside `range` (NFC, words joined by spaces), or null when nothing was said there. */
export function speechIn(transcript: Transcript, range: TimeRange): string | null {
  const parts: string[] = [];
  for (const segment of transcript.segments) {
    if (segment.words.length === 0) {
      if (TimeRange.contains(range, segment.range.start)) parts.push(segment.text);
      continue;
    }
    for (const word of segment.words) if (TimeRange.contains(range, word.range.start)) parts.push(word.text);
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim().normalize('NFC');
  return text === '' ? null : text;
}

/**
 * The stored transcript, or null when there is none or it no longer parses. Its language is the clip's settled one
 * (LIB1-LANG, `settledTranscript`), not the transcriber's guess: every reader goes through here.
 */
export function storedTranscript(db: LibraryDatabase, assetId: AssetId): Transcript | null {
  const row = db.driver.prepare('SELECT transcript FROM transcripts WHERE asset_id = ?').get(assetId);
  if (!row) return null;
  // A row that is not JSON, or not a transcript, reads as no transcript instead of throwing.
  const transcript = parseJsonText(transcriptSchema, String(row.transcript));
  return transcript ? settledTranscript(db, assetId, transcript) : null;
}

/** A function giving the speech inside a range of this asset's stored transcript (null without one). */
export function transcriptTextIn(db: LibraryDatabase, assetId: AssetId): (range: TimeRange) => string | null {
  const transcript = storedTranscript(db, assetId);
  return (range) => (transcript ? speechIn(transcript, range) : null);
}
