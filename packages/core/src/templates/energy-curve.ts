// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The energy curve (P3-V12): beats per clip and pacing per section of a template's slots. `template.setEnergyCurve`
 * re-splits a template; `timelines.planEnergyCurve` and `timeline.applyEnergyCurve` do it inside a project.
 * @taalcut/templates checks that the sections tile the slots in order.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';

export const BEATS_PER_CLIP = [0.5, 1, 2, 3, 4, 6, 8, 12, 16] as const;
export const ENERGY_ALIGN = ['beat', 'downbeat'] as const;

export const energySectionSchema = z.object({
  /** A run of consecutive slots, inclusive. */
  fromSlotId: idSchema<'TemplateSlot'>(),
  toSlotId: idSchema<'TemplateSlot'>(),
  energy: z.number().min(0).max(1),
  beatsPerClip: z.literal(BEATS_PER_CLIP),
  align: z.enum(ENERGY_ALIGN),
});
export type EnergySection = z.output<typeof energySectionSchema>;

export const energyCurveSchema = z.object({ sections: z.array(energySectionSchema).min(1).max(200) });
export type EnergyCurve = z.output<typeof energyCurveSchema>;

/** Per new slot: the old slots it came from; `unchanged` when its start and length are as before. */
export const energySlotMapSchema = z
  .array(
    z.object({
      slotId: idSchema<'TemplateSlot'>(),
      from: z.array(idSchema<'TemplateSlot'>()).min(1).max(200),
      unchanged: z.boolean(),
    }),
  )
  .max(200);
export type EnergySlotMap = z.output<typeof energySlotMapSchema>;
