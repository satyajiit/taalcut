// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Complete, typed shot analyses and on-screen text tracks for stage tests: the fields a stage reads, set plainly. */
import type { OnScreenText, ShotAnalysis, TimeRange } from '@taalcut/core';

export function fakeAnalysis(range: TimeRange, over: Partial<ShotAnalysis> = {}): ShotAnalysis {
  return {
    version: 1,
    range,
    bestFrame: 12,
    orientation: 'landscape',
    quality: { version: 1, sharpness: 0.8, exposure: 0.7, stability: 0.9, overall: 0.75, flags: [] },
    energy: 0.4,
    onScreenText: [],
    dHash: '0123456789abcdef',
    ...over,
  };
}

/** A caption-like track in the lower part of the frame. */
export function fakeText(value: string, range: TimeRange): OnScreenText {
  return {
    text: value,
    box: { x: 0.1, y: 0.8, width: 0.5, height: 0.06 },
    range,
    confidence: 0.9,
    script: 'latin',
    reveal: 'none',
  };
}
