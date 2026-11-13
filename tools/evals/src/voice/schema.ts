// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { loadLabelRows, loadPredictionRows } from '../labelled-files';

const idSchema = z.string().min(1);

export const voiceLineLabelSchema = z
  .object({
    lineId: idSchema,
    slotIndex: z.number().int().nonnegative(),
    /** Beat the first word should land on. */
    beatIndex: z.number().int().nonnegative(),
    /** Frame the first word starts on. */
    wordStartFrame: z.number().int(),
    speechSeconds: z.number().positive(),
    onsetSeconds: z.number().nonnegative(),
    tailSeconds: z.number().nonnegative(),
  })
  .strict();

export const voiceLabelSchema = z
  .object({
    caseId: idSchema,
    synthetic: z.boolean(),
    fps: z.number().int().positive(),
    timelineFrames: z.number().int().positive(),
    slotFrames: z.number().int().positive(),
    /** Slot ids, timeline order. A line's slotIndex points into this list. */
    slots: z.array(idSchema).min(1),
    bpm: z.number().positive(),
    beatSeconds: z.number().positive(),
    shiftMs: z.number().int(),
    lines: z.array(voiceLineLabelSchema),
  })
  .strict();

export const voiceLinePredictionSchema = z
  .object({
    lineId: idSchema,
    startFrame: z.number().int(),
    endFrame: z.number().int(),
    onsetFrame: z.number().int(),
    beatIndex: z.number().int().nonnegative().nullable(),
    beatFrame: z.number().int(),
  })
  .strict();

export const voicePredictionSchema = z
  .object({
    caseId: idSchema,
    lines: z.array(voiceLinePredictionSchema),
  })
  .strict();

export const voiceLabelFileSchema = z.array(voiceLabelSchema).min(1);
export const voicePredictionFileSchema = z.array(voicePredictionSchema).min(1);

export type VoiceLineLabel = z.infer<typeof voiceLineLabelSchema>;
export type VoiceLabel = z.infer<typeof voiceLabelSchema>;
export type VoiceLinePrediction = z.infer<typeof voiceLinePredictionSchema>;
export type VoicePrediction = z.infer<typeof voicePredictionSchema>;

export function loadVoiceLabels(dir: string): VoiceLabel[] {
  return loadLabelRows(dir, {
    what: 'voice labels',
    schema: voiceLabelFileSchema,
    idOf: (row) => row.caseId,
    idName: 'caseId',
  });
}

export function loadVoicePredictions(dir: string): Map<string, VoicePrediction> {
  return loadPredictionRows(dir, {
    what: 'voice predictions',
    schema: voicePredictionFileSchema,
    idOf: (row) => row.caseId,
  });
}
