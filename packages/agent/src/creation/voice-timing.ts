// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime, type CreationDraft } from '@taalcut/core';
import type { CreationVoiceArtifact } from './ports';

/** Speech stays one asset. Visual boundaries use measured absolute speech time, so rounding cannot accumulate. */
export function conformCreationVoice(
  draft: CreationDraft,
  voice: CreationVoiceArtifact | null,
): CreationDraft {
  if (!voice || voice.lines.length === 0) return draft;
  let elapsedMs = 0;
  let frame = 0;
  const beats = draft.beats.map((beat, index) => {
    const line = voice.lines.find((item) => item.beatId === beat.id);
    const next = voice.lines.find((item) => item.beatId === draft.beats[index + 1]?.id);
    const rate = beat.duration.rate;
    if (next?.sourceStartMs !== undefined) elapsedMs = next.sourceStartMs;
    else if (line) elapsedMs = (line.sourceStartMs ?? elapsedMs) + line.durationMs;
    else elapsedMs += RationalTime.toSeconds(beat.duration) * 1000;
    if (index === draft.beats.length - 1) elapsedMs += 1500;
    const end = Math.max(frame + 1, RationalTime.fromSeconds(elapsedMs / 1000, rate).value);
    const duration = RationalTime.of(end - frame, rate);
    frame = end;
    return { ...beat, duration };
  });
  return { ...draft, beats };
}
