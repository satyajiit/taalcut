// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Energy → beats per clip (P3-V12), versioned in config/energy.v1.json. */
import { z } from 'zod';
import { BEATS_PER_CLIP, type EnergyCurve } from '@taalcut/core';
import raw from '../../config/energy.v1.json' with { type: 'json' };

const beats = z.custom<(typeof BEATS_PER_CLIP)[number]>(
  (value) => typeof value === 'number' && (BEATS_PER_CLIP as readonly number[]).includes(value),
);

export const energyConfigSchema = z.object({
  version: z.int().min(1),
  /** Highest minEnergy that is still ≤ the drag wins. Keep them descending. */
  levels: z
    .array(z.object({ minEnergy: z.number().min(0).max(1), beatsPerClip: beats }))
    .min(1)
    .max(16),
});

export type EnergyConfig = z.output<typeof energyConfigSchema>;

export const ENERGY_CONFIG: EnergyConfig = energyConfigSchema.parse(raw);

export type BeatsPerClip = EnergyCurve['sections'][number]['beatsPerClip'];

/** The beats per clip a drag sets when the person has not typed one. */
export function beatsForEnergy(energy: number, config: EnergyConfig = ENERGY_CONFIG): BeatsPerClip {
  const level = config.levels.find((item) => energy >= item.minEnergy);
  return level?.beatsPerClip ?? 16;
}
