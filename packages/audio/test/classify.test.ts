// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Audio-type rules and the golden-reel labels. Pure: no ffmpeg, no models. */
import { describe, expect, it } from 'vitest';
import { classifyAudio } from '../src/measure/classify';
import { musicScoreOf, speechRatioOf } from '../src/measure/score';
import type { AudioEvidence } from '../src/measure/types';
import { GOLDEN_AUDIO_LABELS, type AudioKind } from '../src/measure/labels';
import { msRange } from '../src/rates';

const quiet: AudioEvidence = { speechRatio: 0, musicScore: 0, integratedLufs: -20, nonSilentRatio: 0.8 };

const cases: {
  name: string;
  evidence: AudioEvidence;
  kind: AudioKind;
  golden: (typeof GOLDEN_AUDIO_LABELS)[AudioKind];
  dropped?: 'music';
}[] = [
  {
    name: 'silent when loudness is under -50',
    evidence: { ...quiet, integratedLufs: -50.1 },
    kind: 'silent',
    golden: 'silence',
  },
  {
    name: 'not silent at exactly -50 LUFS',
    evidence: { ...quiet, integratedLufs: -50 },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'silent when non-silent ratio is under 0.1',
    evidence: { ...quiet, nonSilentRatio: 0.099 },
    kind: 'silent',
    golden: 'silence',
  },
  {
    name: 'not silent at a non-silent ratio of exactly 0.1',
    evidence: { ...quiet, nonSilentRatio: 0.1 },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'null loudness does not force silence',
    evidence: { ...quiet, integratedLufs: null },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'music at the score floor with speech under 0.15',
    evidence: { ...quiet, musicScore: 0.6, speechRatio: 0.149 },
    kind: 'music',
    golden: 'music',
    dropped: 'music',
  },
  {
    name: 'music score just under 0.6 is not music',
    evidence: { ...quiet, musicScore: 0.599, speechRatio: 0.149 },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'speech ratio of 0.15 with a music score is mixed, not music',
    evidence: { ...quiet, musicScore: 0.6, speechRatio: 0.15 },
    kind: 'mixed',
    golden: 'mixed',
  },
  {
    name: 'voice at the speech floor with music under 0.4',
    evidence: { ...quiet, speechRatio: 0.3, musicScore: 0.399 },
    kind: 'voice',
    golden: 'speech',
  },
  {
    name: 'voice speech just under 0.3',
    evidence: { ...quiet, speechRatio: 0.299, musicScore: 0.399 },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'voice music score of 0.4 is mixed',
    evidence: { ...quiet, speechRatio: 0.3, musicScore: 0.4 },
    kind: 'mixed',
    golden: 'mixed',
  },
  {
    name: 'mixed at both floors',
    evidence: { ...quiet, speechRatio: 0.15, musicScore: 0.4 },
    kind: 'mixed',
    golden: 'mixed',
  },
  {
    name: 'mixed speech just under 0.15',
    evidence: { ...quiet, speechRatio: 0.149, musicScore: 0.4 },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'mixed music just under 0.4',
    evidence: { ...quiet, speechRatio: 0.15, musicScore: 0.399 },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'original ambience',
    evidence: { ...quiet, speechRatio: 0.2, musicScore: 0.2 },
    kind: 'original',
    golden: 'ambience',
  },
  {
    name: 'silence wins before a high music score',
    evidence: { ...quiet, integratedLufs: -60, musicScore: 0.9 },
    kind: 'silent',
    golden: 'silence',
  },
];

describe('classifyAudio', () => {
  it.each(cases)('$name', ({ evidence, kind, golden, dropped }) => {
    const result = classifyAudio(evidence);
    expect(result.kind).toBe(kind);
    expect(result.silent).toBe(kind === 'silent');
    expect(result.evidence).toBe(evidence);
    expect(result.transcriptDropped).toBe(dropped);
    expect(GOLDEN_AUDIO_LABELS[result.kind]).toBe(golden);
  });
});

describe('speechRatioOf and musicScoreOf', () => {
  it('merges overlaps, drops low confidence, and caps at 1', () => {
    const ratio = speechRatioOf(
      [
        { range: msRange(0, 1000), confidence: 0.9 },
        { range: msRange(500, 1000), confidence: 1 },
        { range: msRange(1500, 500), confidence: 0.49 },
        { range: msRange(2000, 500) },
      ],
      4000,
    );
    expect(ratio).toBeCloseTo(0.5);
    expect(speechRatioOf([{ range: msRange(0, 5000), confidence: 1 }], 1000)).toBe(1);
    expect(speechRatioOf([{ range: msRange(0, 500) }], 0)).toBe(0);
  });

  it('is mean activation times beat regularity, 0 without two intervals', () => {
    expect(musicScoreOf([1, 1], [true, true], [500, 500])).toBe(1);
    expect(musicScoreOf([1], [true], [500])).toBe(0);
    expect(musicScoreOf([], [], [])).toBe(0);
    expect(musicScoreOf([0.5, 0.5], [false, false], [100, 100])).toBeCloseTo(0.5);
    expect(musicScoreOf([1, 1], [true, true], [100, 300])).toBe(0);
  });
});
