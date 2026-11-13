// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Mix commands (P3-V6): the timeline's ducking and the sound effects on its cuts. Handlers: @taalcut/audio.
 * `music.setDucking`'s inverse is itself with the previous settings; `sfx.setHits` replaces the effects track
 * (role 'sfx') and its inverse is `timeline.restore { tracks }`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { duckingSettingsSchema, SFX_CATEGORIES } from '../timeline/mix';

export const MIX_COMMANDS = {
  setDucking: 'music.setDucking',
  setHits: 'sfx.setHits',
} as const;

/** EAR1-D3: a kit's role, lowercase words joined by dots, as earshot's kits name them: 'hit', 'whoosh.short'. */
export const sfxKitRoleSchema = z
  .string()
  .max(48)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/);
/** EAR1-D2: an SFX bank sound's id, its family and variant: 'cut_hit/sub', 'whoosh_fast/crisp'. */
export const sfxBankSoundIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(?:\/[a-z0-9_]+)?$/);

export const sfxHitSchema = z.object({
  id: idSchema<'TimelineItem'>(),
  /** Timeline time of the sound's start (its peak lands on the cut). */
  at: rationalTimeSchema,
  assetId: idSchema<'Asset'>(),
  sourceStart: rationalTimeSchema,
  duration: rationalTimeSchema,
  gainDb: z.number().min(-40).max(0),
  category: z.enum(SFX_CATEGORIES),
  /** EAR1-D3: the kit role it plays, when a kit placed it. */
  kitRole: sfxKitRoleSchema.optional(),
  /** EAR1-D2: the bank sound it is a take of, when it came from the SFX bank. */
  soundId: sfxBankSoundIdSchema.optional(),
  /**
   * EAR1-K3: the timeline time of the cut it was placed to land on (its apex, a whoosh's peak), when a planner
   * placed it for one. The clip keeps it as its sync point, so render QA judges each effect on its own cut.
   */
  cut: rationalTimeSchema.optional(),
});
export type SfxHit = z.output<typeof sfxHitSchema>;

const target = { projectId: idSchema<'Project'>(), timelineId: idSchema<'Timeline'>() };

export const mixCommandPayloads = {
  [MIX_COMMANDS.setDucking]: z.object({
    ...target,
    ducking: duckingSettingsSchema
      .partial()
      .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' }),
  }),
  [MIX_COMMANDS.setHits]: z.object({
    ...target,
    revision: z.int().positive().optional(),
    hits: z.array(sfxHitSchema).max(200),
  }),
};
