// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL (contract §2): why a made video's text or graphic item sits where it does. Timeline's placement solver
 * picks each item's box so it never covers a person's head and keeps the reel's relation; the item records the
 * box it chose (a graphic's `placement.box`, a text item's `box`) and the reason, so render, the preview and QA
 * all draw and check the same box.
 *
 * - `asReel`: where the reel's relation puts it.
 * - `moved`: a head or another item was in the way, so it moved to the nearest place that keeps the relation best.
 * - `shrunk`: it fit only smaller (never below QA's readable size).
 * - `retimed`: the clip's in-point moved within its usable range to a moment with room.
 * - `recast`: the slot took the next-best clip that has room.
 * - `noRoom`: nothing fits; render QA's `graphicCoversFace` fails with a plain reason.
 *
 * An item without a record (made before FRM1, or placed by the person) is left where it is.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const PLACEMENT_REASONS = ['asReel', 'moved', 'shrunk', 'retimed', 'recast', 'noRoom'] as const;
export type PlacementReason = (typeof PLACEMENT_REASONS)[number];

export const madePlacementSchema = z.object({ reason: z.enum(PLACEMENT_REASONS) });
export type MadePlacement = z.output<typeof madePlacementSchema>;
