// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, TimeRange, ok, type Transcript } from '@taalcut/core';
import { createSpeechWordAligner, wordsFromTranscript, type SpeechEngine } from '@taalcut/audio';

const MS = FrameRate.of(1000, 1);

function makeTranscript(): Transcript {
  return {
    version: 1,
    language: 'en',
    engine: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3',
    local: true,
    wordTiming: 'native',
    segments: [
      {
        text: 'Golden hour cut',
        language: 'en',
        range: TimeRange.of(RationalTime.of(0, MS), RationalTime.of(1200, MS)),
        words: [
          {
            text: 'Golden',
            range: TimeRange.of(RationalTime.of(50, MS), RationalTime.of(350, MS)),
            confidence: 0.98,
          },
          {
            text: 'hour',
            range: TimeRange.of(RationalTime.of(420, MS), RationalTime.of(300, MS)),
            confidence: 0.97,
          },
          {
            text: 'cut',
            range: TimeRange.of(RationalTime.of(760, MS), RationalTime.of(440, MS)),
            confidence: 0.99,
          },
        ],
      },
    ],
  };
}

describe('createSpeechWordAligner (WP-VO-LOCAL)', () => {
  it('extracts word start and end seconds from a Transcript and cleans up temporary WAV files', async () => {
    let seenPath = '';
    const engine: SpeechEngine = {
      id: 'parakeet',
      languages: () => ['en'],
      async transcribe(audioPath) {
        seenPath = audioPath;
        expect(existsSync(audioPath)).toBe(true);
        return ok(makeTranscript());
      },
    };

    const aligner = createSpeechWordAligner({ engine });
    const result = await aligner.alignWords({
      wavBytes: new Uint8Array([82, 73, 70, 70]),
      text: 'Golden hour cut',
      language: 'en',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { word: 'Golden', startSeconds: 0.05, endSeconds: 0.4 },
      { word: 'hour', startSeconds: 0.42, endSeconds: 0.72 },
      { word: 'cut', startSeconds: 0.76, endSeconds: 1.2 },
    ]);
    expect(wordsFromTranscript(makeTranscript())).toEqual(result.value);
    expect(seenPath.endsWith('line.wav')).toBe(true);
    expect(existsSync(seenPath)).toBe(false);
  });
});
