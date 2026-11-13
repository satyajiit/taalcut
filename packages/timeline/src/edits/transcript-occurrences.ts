// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  RationalTime,
  type AssetId,
  type Timeline,
  type Transcript,
  type TranscriptOccurrence,
} from '@taalcut/core';
import { positions } from '../model/sequence';
import { speechItems } from '../model/speech';
import { sourceFrames } from '../model/speed';

/** Inverse of the same integrated speed curve used by clip edits and render. */
export function outputFrameAt(
  clip: { speed: Parameters<typeof sourceFrames>[0]; duration: RationalTime },
  source: number,
) {
  if (!clip.speed) return source;
  let low = 0;
  let high = clip.duration.value;
  for (let step = 0; step < 48; step += 1) {
    const mid = (low + high) / 2;
    if (sourceFrames(clip.speed, mid) < source) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Every duplicate clip has its own occurrence references; no matching by caption text or source asset alone. */
export function transcriptOccurrences(
  timeline: Timeline,
  transcripts: ReadonlyMap<AssetId, Transcript>,
): TranscriptOccurrence[] {
  const rate = timeline.canvas.rate;
  const fps = rate.num / rate.den;
  const words: TranscriptOccurrence[] = [];
  for (const { item, start } of positions(speechItems(timeline))) {
    if (
      item.type !== 'clip' ||
      item.media.kind === 'image' ||
      item.holdFrame ||
      !item.enabled ||
      (timeline.speechTrackId && item.audio.muted)
    )
      continue;
    const transcript = transcripts.get(item.media.assetId);
    if (!transcript) continue;
    const sourceStart = RationalTime.toSeconds(item.sourceStart);
    const sourceLength = sourceFrames(item.speed, item.duration.value);
    transcript.segments.forEach((segment, segmentIndex) =>
      segment.words.forEach((word, wordIndex) => {
        const from = (RationalTime.toSeconds(word.range.start) - sourceStart) * fps;
        const to = from + RationalTime.toSeconds(word.range.duration) * fps;
        if (to <= 0 || from >= sourceLength) return;
        const first = Math.max(0, Math.floor(outputFrameAt(item, Math.max(0, from)) + 1e-7));
        const last = Math.min(
          item.duration.value,
          Math.ceil(outputFrameAt(item, Math.min(sourceLength, to)) - 1e-7),
        );
        if (last <= first) return;
        words.push({
          clipId: item.id,
          assetId: item.media.assetId,
          segment: segmentIndex,
          word: wordIndex,
          source: word.range,
          text: word.text,
          range: {
            start: RationalTime.of(start + first, rate),
            duration: RationalTime.of(last - first, rate),
          },
        });
      }),
    );
  }
  return words;
}
