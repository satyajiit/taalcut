// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A transcript's words in milliseconds on the asset clock, the shape the cleanup rules read. Pure. */
import { RationalTime, TimeRange, type Transcript } from '@taalcut/core';
import type { Span } from './segments';

export interface TimedWord extends Span {
  readonly text: string;
  readonly confidence: number;
}

export function transcriptWords(transcript: Transcript): TimedWord[] {
  const words: TimedWord[] = [];
  for (const segment of transcript.segments)
    for (const word of segment.words)
      words.push({
        text: word.text,
        startMs: RationalTime.toSeconds(word.range.start) * 1000,
        endMs: RationalTime.toSeconds(TimeRange.end(word.range)) * 1000,
        confidence: word.confidence ?? 1,
      });
  return words.sort((a, b) => a.startMs - b.startMs);
}
