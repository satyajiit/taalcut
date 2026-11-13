// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the voice write tools hand back to the model (SPEC P3.9): the voiceover's id and quality, and per line its
 * asset, where it starts on the timeline, how long it speaks and whether its onset missed its beat. Milliseconds
 * here are the model-facing edge; the timeline keeps RationalTime.
 */
import { RationalTime, VOICEOVER_QUALITIES, type VoiceLine } from '@taalcut/core';
import { z } from 'zod';
import type { VoiceoverOutcome } from '../voice/voiceover';
import { lineDurationMs } from '../voice/voice-lines';

export const voiceoverToolOutputSchema = z.object({
  voiceoverId: z.string(),
  quality: z.enum(VOICEOVER_QUALITIES),
  lines: z
    .array(
      z.object({
        lineId: z.string(),
        assetId: z.string().nullable(),
        startMs: z.int().nonnegative().describe('Where the line starts on the timeline'),
        durationMs: z.int().nonnegative().describe('How long it speaks'),
        offBeat: z.boolean().describe("The onset couldn't land on its beat"),
      }),
    )
    .max(40),
  warnings: z
    .array(z.string())
    .max(40)
    .describe('What placement had to do: pre-laps, compression, off-beat onsets'),
  costUsd: z.number().nonnegative(),
});
export type VoiceoverToolOutput = z.output<typeof voiceoverToolOutputSchema>;

/** draft, final, or mixed while some lines are final and some aren't. */
export function voiceoverQuality(
  lines: readonly Pick<VoiceLine, 'quality'>[],
): (typeof VOICEOVER_QUALITIES)[number] {
  if (lines.every((line) => line.quality === 'final')) return 'final';
  if (lines.every((line) => line.quality === 'draft')) return 'draft';
  return 'mixed';
}

/** A timeline time as whole milliseconds: the model-facing edge. */
const msOf = (time: RationalTime | undefined) =>
  time ? Math.max(0, Math.round(RationalTime.toSeconds(time) * 1000)) : 0;

export function voiceoverToolOutput(outcome: VoiceoverOutcome): VoiceoverToolOutput {
  const { voiceover } = outcome.payload;
  const starts = new Map(outcome.lines.map((line) => [line.lineId, line]));
  return {
    voiceoverId: voiceover.id,
    quality: voiceoverQuality(voiceover.lines),
    lines: voiceover.lines.map((line) => ({
      lineId: line.id,
      assetId: line.assetId,
      startMs: msOf(starts.get(line.id)?.start),
      durationMs: lineDurationMs(line),
      offBeat: line.offBeat,
    })),
    warnings: [...outcome.warnings].slice(0, 40),
    costUsd: outcome.costUsd,
  };
}
