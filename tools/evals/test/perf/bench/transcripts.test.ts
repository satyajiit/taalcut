// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Which engine transcribed: from the audio.transcript rows' job kinds, said in summary.md. */
import { describe, expect, it } from 'vitest';
import { engineOf, transcriptLine } from '../../../src/perf/bench/transcripts';

describe('transcriptLine', () => {
  it('names whisper and says Parakeet was absent, with the kinds per run', () => {
    const run = { kinds: { 'audio.transcribeAssetWhisper': 14 }, skipped: 4 };
    expect(transcriptLine([run, run, null])).toBe(
      'Transcript engine: whisper (Parakeet component absent); audio.transcribeAssetWhisper 14 per run; 4 skipped per run.',
    );
  });

  it('names Parakeet when it ran, the kind before IX as whisper, and runs without a timeline', () => {
    expect(transcriptLine([{ kinds: { 'audio.transcribeAssetParakeet': 3 }, skipped: 0 }])).toBe(
      'Transcript engine: Parakeet; audio.transcribeAssetParakeet 3 per run.',
    );
    expect(engineOf('audio.transcribeAsset')).toBe('whisper (before IX)');
    expect(transcriptLine([null])).toBe('Transcript engine: not read (no timeline).');
    expect(transcriptLine([{ kinds: {}, skipped: 2 }])).toBe(
      'Transcript engine: none ran (Parakeet component absent); 2 skipped per run.',
    );
  });
});
