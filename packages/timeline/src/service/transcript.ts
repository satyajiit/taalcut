// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  NotImplementedError,
  ok,
  type AssetId,
  type AsyncResult,
  type Timeline,
  type TimelineTranscript,
  type Transcript,
} from '@taalcut/core';
import { transcriptOccurrences } from '../edits/transcript-occurrences';
import { speechItems } from '../model/speech';

export type TranscriptReader = (assetId: AssetId) => AsyncResult<Transcript | null>;

export async function readTimelineTranscript(
  timeline: Timeline,
  read?: TranscriptReader,
): AsyncResult<TimelineTranscript> {
  if (!read) return err(NotImplementedError({ feature: 'timelines.transcript' }));
  const transcripts = new Map<AssetId, Transcript>();
  const assets = new Set(
    speechItems(timeline).flatMap((item) =>
      item.type === 'clip' && item.media.kind !== 'image' ? [item.media.assetId] : [],
    ),
  );
  for (const asset of assets) {
    const found = await read(asset);
    if (!found.ok) return found;
    if (found.value) transcripts.set(asset, found.value);
  }
  return ok({
    timelineId: timeline.id,
    revision: timeline.revision,
    words: transcriptOccurrences(timeline, transcripts),
  });
}
