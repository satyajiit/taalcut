// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CAPTION_PRESETS, FrameRates, newId, RationalTime, TimeRange, type Transcript } from '@taalcut/core';
import { buildTimeline, clipById } from '../fixtures/timeline';

export const at = (value: number) => RationalTime.of(value, FrameRates.fps30);
export const span = (start: number, duration: number) => TimeRange.of(at(start), at(duration));
export function fixture() {
  const built = buildTimeline({
    beats: false,
    clips: [
      { frames: 90, sourceStart: 0 },
      { frames: 90, sourceStart: 0 },
    ],
    texts: [{ start: 0, frames: 180 }],
  });
  built.timeline.captions = {
    enabled: true,
    language: 'en',
    style: CAPTION_PRESETS.classic,
    styleSource: 'preset',
    cues: [0, 1].map((n) => ({
      id: newId<'CaptionCue'>(),
      range: span(n * 90, 45),
      edited: false,
      words: [{ text: 'Hello world', range: span(n * 90, 45), confidence: 1 }],
    })),
  };
  const transcript: Transcript = {
    version: 1,
    engine: 'whisper',
    model: 'recorded',
    local: true,
    language: 'en',
    wordTiming: 'native',
    segments: [
      {
        text: 'Hello world',
        language: 'en',
        range: span(0, 45),
        words: [
          { text: 'Hello', range: span(0, 15) },
          { text: 'world', range: span(15, 30) },
        ],
      },
    ],
  };
  const first = clipById(built.timeline, built.ids[0]!);
  return {
    ...built,
    transcript,
    first,
    target: { projectId: built.timeline.projectId, timelineId: built.timeline.id, revision: 1 },
  };
}
