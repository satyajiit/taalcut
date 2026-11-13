// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot's four kit presets (forge/kits, vendored unchanged in @taalcut-vendor/earshot-data): calm (text-led films,
 * the default), crisp (energetic product films), minimal (designed, effects only) and launch (films cut to music,
 * with earshot 0.4's mix keys). Each is a kit file of schema 1; `parseKit` checks one against the installed bank.
 */
import calm from '@taalcut-vendor/earshot-data/kits/calm.json' with { type: 'json' };
import crisp from '@taalcut-vendor/earshot-data/kits/crisp.json' with { type: 'json' };
import launch from '@taalcut-vendor/earshot-data/kits/launch.json' with { type: 'json' };
import minimal from '@taalcut-vendor/earshot-data/kits/minimal.json' with { type: 'json' };
import { kitSchema, type Kit } from './schema';

export const KIT_PRESETS = ['calm', 'crisp', 'minimal', 'launch'] as const;
export type KitPreset = (typeof KIT_PRESETS)[number];

const FILES: Readonly<Record<KitPreset, unknown>> = { calm, crisp, minimal, launch };

/** A preset as a kit (its shape checked; the vendored files are pinned by sha256 in third_party/earshot's test). */
export function kitPreset(name: KitPreset): Kit {
  return kitSchema.parse(FILES[name]);
}
