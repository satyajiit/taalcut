// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { scoreVoiceCase } from '../../src/voice/metric';
import { scoreVoice } from '../../src/voice/run';
import type {
  VoiceLabel,
  VoiceLineLabel,
  VoiceLinePrediction,
  VoicePrediction,
} from '../../src/voice/schema';

function line(lineId: string, beatIndex: number, wordStartFrame: number): VoiceLineLabel {
  return {
    lineId,
    slotIndex: 0,
    beatIndex,
    wordStartFrame,
    speechSeconds: 1,
    onsetSeconds: 0.15,
    tailSeconds: 0.2,
  };
}

function placed(
  lineId: string,
  startFrame: number,
  endFrame: number,
  onsetFrame: number,
  beatIndex: number | null,
  beatFrame: number,
): VoiceLinePrediction {
  return { lineId, startFrame, endFrame, onsetFrame, beatIndex, beatFrame };
}

function label(lines: VoiceLineLabel[], timelineFrames = 100): VoiceLabel {
  return {
    caseId: 'hand',
    synthetic: true,
    fps: 30,
    timelineFrames,
    slotFrames: 40,
    slots: ['slot-a', 'slot-b'],
    bpm: 100,
    beatSeconds: 8,
    shiftMs: 0,
    lines,
  };
}

function score(lines: VoiceLineLabel[], rows: VoiceLinePrediction[], timelineFrames = 100) {
  return scoreVoiceCase(label(lines, timelineFrames), { caseId: 'hand', lines: rows });
}

describe('voice scorer', () => {
  it('accepts a first word within one frame of the planned beat', () => {
    const row = score([line('a', 2, 10)], [placed('a', 8, 40, 10, 2, 10)]);
    expect(row.onBeatShare).toBe(1);
    expect(row.overlaps).toBe(0);
    expect(row.outside).toBe(0);
  });

  it('accepts one frame either side of the labelled first word, and no more', () => {
    expect(score([line('a', 2, 10)], [placed('a', 8, 40, 11, 2, 10)]).onBeatShare).toBe(1);
    // Placed beat one frame late and the word one frame after that: two frames from the label.
    expect(score([line('a', 2, 10)], [placed('a', 8, 40, 12, 2, 11)]).onBeatShare).toBe(0);
  });

  it('rejects a two-frame miss and a wrong beat index', () => {
    expect(score([line('a', 2, 12)], [placed('a', 8, 40, 10, 2, 10)]).onBeatShare).toBe(0);
    expect(score([line('a', 2, 10)], [placed('a', 8, 40, 12, 2, 10)]).onBeatShare).toBe(0);
    expect(score([line('a', 2, 10)], [placed('a', 8, 40, 10, 3, 10)]).onBeatShare).toBe(0);
  });

  it('counts an overlap and a line past the timeline, not ranges that only touch', () => {
    const overlap = score(
      [line('a', 1, 0), line('b', 2, 9)],
      [placed('a', 0, 10, 0, 1, 0), placed('b', 9, 20, 9, 2, 9)],
    );
    expect(overlap.overlaps).toBe(1);
    const touching = score(
      [line('a', 1, 0), line('b', 2, 10)],
      [placed('a', 0, 10, 0, 1, 0), placed('b', 10, 20, 10, 2, 10)],
    );
    expect(touching.overlaps).toBe(0);
    const past = score([line('a', 1, 90)], [placed('a', 90, 101, 90, 1, 90)], 100);
    expect(past.outside).toBe(1);
    const flush = score([line('a', 1, 80)], [placed('a', 80, 100, 80, 1, 80)], 100);
    expect(flush.outside).toBe(0);
  });

  it('does not pass an empty line list', () => {
    const report = scoreVoice(
      [label([])],
      new Map<string, VoicePrediction>([['hand', { caseId: 'hand', lines: [] }]]),
    );
    expect(report.metrics.find((metric) => metric.name === 'onBeatShare')?.value).toBe(0);
    expect(report.gate.pass).toBe(false);
    expect(report.claimed).toBe(false);
  });
});
