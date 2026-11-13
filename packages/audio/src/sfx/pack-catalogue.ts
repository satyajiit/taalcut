// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bundled sound pack (`sfx-pack` component, SPEC P3.6): `catalogue.json` beside Opus files, every item a
 * CC0-1.0 dedication with where it came from. The catalogue is read once per use and validated (it is a file on
 * disk); a missing or unreadable one is `audio.sfx_pack_missing`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, SFX_CATEGORIES, type AsyncResult } from '@taalcut/core';
import { z } from 'zod';
import { SfxPackMissing } from './errors';

export const sfxPackItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  title: z.string().min(1).max(120),
  category: z.enum(SFX_CATEGORIES),
  /** Relative to the pack folder; no folders. */
  file: z.string().regex(/^[a-z0-9-]+\.(opus|ogg|flac|wav)$/),
  durationMs: z.int().positive().max(30_000),
  /** Where the sound's peak is: the instant that lands on the cut (a riser's is its end). */
  peakMs: z.int().nonnegative(),
  /** Its momentary-max loudness (ebur128 M), for levelling under the music. */
  loudnessLufs: z.number().min(-70).max(0),
  licence: z.literal('CC0-1.0'),
  /** The dedication or the generator: where anyone can check the licence. */
  source: z.url().max(500),
});
export type SfxPackItem = z.output<typeof sfxPackItemSchema>;

export const sfxPackCatalogueSchema = z.object({
  version: z.literal(1),
  pack: z.literal('sfx-pack'),
  packVersion: z.string().min(1).max(40),
  items: z.array(sfxPackItemSchema).min(1).max(500),
});
export type SfxPackCatalogue = z.output<typeof sfxPackCatalogueSchema>;

export interface SfxPack {
  readonly items: readonly SfxPackItem[];
  pathOf(item: SfxPackItem): string;
}

export async function loadSfxPack(dir: string): AsyncResult<SfxPack> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'catalogue.json'), 'utf8');
  } catch {
    return err(SfxPackMissing(undefined, { detail: 'no catalogue.json in the sfx-pack component' }));
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err(SfxPackMissing(undefined, { detail: 'catalogue.json is not JSON' }));
  }
  const parsed = sfxPackCatalogueSchema.safeParse(json);
  if (!parsed.success)
    return err(SfxPackMissing(undefined, { detail: parsed.error.issues[0]?.message ?? 'bad catalogue' }));
  const items = parsed.data.items;
  return ok({ items, pathOf: (item) => join(dir, item.file) });
}
