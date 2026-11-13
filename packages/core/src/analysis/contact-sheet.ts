// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's annotated Set-of-Mark contact sheet, built during library analysis
 * (`vision.contactSheet`) and stored in the media cache as a derived still JPEG.
 * Each tile is stamped with `#<1-based index> · MM:SS.t` and mapped back to its
 * exact grid frame, `RationalTime`, and shot so both the UI and AI models can
 * inspect a clip's visual progression and trim points at a glance.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { frameRateSchema } from '../time/frame-rate';
import { rationalTimeSchema } from '../time/rational-time';
import { derivedFileRefSchema } from './media-facts';

export const ASSET_CONTACT_SHEET_MAX_TILES = 60;

export const assetContactSheetTileSchema = z.object({
  tile: z.int().nonnegative().max(ASSET_CONTACT_SHEET_MAX_TILES - 1),
  frame: z.int().nonnegative(),
  at: rationalTimeSchema,
  shotId: idSchema<'Shot'>().optional(),
});
export type AssetContactSheetTile = z.output<typeof assetContactSheetTileSchema>;

export const assetContactSheetSchema = z.object({
  file: derivedFileRefSchema.refine((ref) => ref.kind === 'still' && ref.mimeType === 'image/jpeg', {
    message: 'Expected a contact sheet JPEG',
  }),
  width: z.int().positive().max(8192),
  height: z.int().positive().max(16384),
  columns: z.int().positive().max(ASSET_CONTACT_SHEET_MAX_TILES),
  tileWidth: z.int().positive().max(2048),
  tileHeight: z.int().positive().max(2048),
  frameRate: frameRateSchema,
  layout: z.array(assetContactSheetTileSchema).min(1).max(ASSET_CONTACT_SHEET_MAX_TILES),
});
export type AssetContactSheet = z.output<typeof assetContactSheetSchema>;
