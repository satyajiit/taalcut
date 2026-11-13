// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A timeline's voiceover (P3-B6, audio SPEC P3.8): the voice, its language and seed, and each line with the clip
 * that plays it on the voice track (an audio track of role 'voice'). Part of Timeline v2 (`timeline.voiceover`);
 * applied and removed with VOICE_COMMANDS. A line's length is media time (RationalTime), on its clip's clock.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { languageTagSchema } from '../templates/template-parts';
import { fromMilliseconds } from '../time/milliseconds';
import { rationalTimeSchema } from '../time/rational-time';

/** Drafts on the fast model, finals on the flagship. */
export const VOICE_QUALITIES = ['draft', 'final'] as const;
export type VoiceQuality = (typeof VOICE_QUALITIES)[number];

const lineFields = {
  id: idSchema<'VoiceLine'>(),
  /** What is said: the agent's or the user's words. Plain text. */
  text: z.string().min(1).max(500),
  slotId: idSchema<'TemplateSlot'>().nullable(),
  /** The clip on the voice track; null until placed. */
  clipId: idSchema<'TimelineItem'>().nullable(),
  assetId: idSchema<'Asset'>().nullable(),
  quality: z.enum(VOICE_QUALITIES),
  /** The onset couldn't land on its beat (the tool result says why). */
  offBeat: z.boolean(),
};

export const voiceLineSchema = z
  .object({
    ...lineFields,
    /** How long the line plays, at the voice clip's rate (the asset's or the canvas's): the clip's own clock. */
    duration: rationalTimeSchema
      .refine((time) => time.value >= 0, { message: 'Duration must not be negative' })
      .optional(),
    /**
     * @deprecated Round P3-1's unit, read only so a Timeline stored then still parses; it becomes `duration` at
     * 1000/1, exactly. Write `duration`.
     */
    durationMs: z.int().nonnegative().optional(),
  })
  .transform(({ durationMs, duration, ...line }, context) => {
    if (duration) return { ...line, duration };
    if (durationMs !== undefined) return { ...line, duration: fromMilliseconds(durationMs) };
    context.addIssue({ code: 'custom', message: 'A line has a duration', path: ['duration'] });
    return z.NEVER;
  });
export type VoiceLine = z.output<typeof voiceLineSchema>;

export const voiceoverSchema = z.object({
  id: idSchema<'Voiceover'>(),
  /** The provider's voice id. */
  voiceId: z.string().min(1).max(64),
  /** Provider text, untrusted; for display. */
  voiceName: z.string().max(80),
  /** A clone of the user's own voice (VoiceConsentStore). */
  own: z.boolean(),
  language: languageTagSchema,
  seed: z.int().nonnegative(),
  lines: z.array(voiceLineSchema).max(40),
});
export type Voiceover = z.output<typeof voiceoverSchema>;
