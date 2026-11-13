// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The stored transcripts of a set of assets (captions build cues from them; the mix finds speech in them). */
import { ok, type AssetId, type AsyncResult, type Transcript } from '@taalcut/core';
import type { TranscriptSource } from '../ports';

/** Each asset's transcript, looked up once; an asset without one is absent. The first failed read is the error. */
export async function transcriptsOf(
  source: TranscriptSource,
  assetIds: Iterable<AssetId>,
): AsyncResult<Map<AssetId, Transcript>> {
  const found = new Map<AssetId, Transcript>();
  for (const assetId of new Set(assetIds)) {
    const transcript = await source.transcript(assetId);
    if (!transcript.ok) return transcript;
    if (transcript.value) found.set(assetId, transcript.value);
  }
  return ok(found);
}

/** Whether a transcript has any spoken word. */
export const hasSpeech = (transcript: Transcript) =>
  transcript.segments.some((segment) => segment.words.length > 0);
