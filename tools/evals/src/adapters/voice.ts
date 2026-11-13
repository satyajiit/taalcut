// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** planPlacement on the in-memory timeline the voice fixture describes. No analyser, no audio files. */
import { RationalTime } from '@taalcut/core';
import { planPlacement } from '@taalcut/audio';
import { placementLines, voiceTimeline } from '../voice/fixtures';
import type { VoiceLabel, VoicePrediction } from '../voice/schema';

export function predictVoice(labels: readonly VoiceLabel[]): VoicePrediction[] {
  return labels.map((label) => {
    const timeline = voiceTimeline(label);
    const placed = planPlacement(timeline, placementLines(label));
    if (!placed.ok) throw new Error(`planPlacement: ${placed.error.code}`);
    const beats = (timeline.beatMap?.beats ?? []).map((beat) =>
      RationalTime.toFrames(beat, timeline.canvas.rate),
    );
    return {
      caseId: label.caseId,
      lines: placed.value.placements.map((row) => {
        const beatFrame = row.beatIndex === null ? row.onsetFrame : (beats[row.beatIndex] ?? row.onsetFrame);
        return {
          lineId: row.lineId,
          startFrame: row.startFrame,
          endFrame: row.startFrame + row.durationFrames,
          onsetFrame: row.onsetFrame,
          beatIndex: row.beatIndex,
          beatFrame,
        };
      }),
    };
  });
}
