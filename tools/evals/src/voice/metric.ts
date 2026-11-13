// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { VoiceLabel, VoiceLineLabel, VoiceLinePrediction, VoicePrediction } from './schema';

/** onBeatShare is 1 only when every line lands; an empty case does not pass. */
export const VOICE_BARS = { onBeatShare: 1, overlaps: 0, outside: 0 } as const;

export interface VoiceCaseScore {
  readonly caseId: string;
  readonly lines: number;
  readonly onBeatShare: number;
  readonly overlaps: number;
  readonly outside: number;
}

/** [start, end). Touching endpoints is not an overlap. */
export function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

/** The placed first word starts within 1 frame of the labelled one, on the labelled beat. */
function onBeat(label: VoiceLineLabel, prediction: VoiceLinePrediction): boolean {
  if (prediction.beatIndex === null || prediction.beatIndex !== label.beatIndex) return false;
  return Math.abs(prediction.onsetFrame - label.wordStartFrame) <= 1;
}

export function scoreVoiceCase(label: VoiceLabel, prediction: VoicePrediction): VoiceCaseScore {
  const placed = prediction.lines;
  let hits = 0;
  let outside = 0;
  for (const line of label.lines) {
    const row = placed.find((item) => item.lineId === line.lineId);
    if (row === undefined) throw new Error(`No placement for ${line.lineId}`);
    if (onBeat(line, row)) hits += 1;
    if (row.startFrame < 0 || row.endFrame > label.timelineFrames) outside += 1;
  }
  let overlaps = 0;
  for (let left = 0; left < placed.length; left += 1) {
    for (let right = left + 1; right < placed.length; right += 1) {
      const a = placed[left];
      const b = placed[right];
      if (
        a !== undefined &&
        b !== undefined &&
        rangesOverlap(a.startFrame, a.endFrame, b.startFrame, b.endFrame)
      ) {
        overlaps += 1;
      }
    }
  }
  return {
    caseId: label.caseId,
    lines: label.lines.length,
    onBeatShare: label.lines.length === 0 ? 0 : hits / label.lines.length,
    overlaps,
    outside,
  };
}

export function voiceGatePasses(row: VoiceCaseScore): boolean {
  return (
    row.onBeatShare === VOICE_BARS.onBeatShare &&
    row.overlaps === VOICE_BARS.overlaps &&
    row.outside === VOICE_BARS.outside
  );
}
