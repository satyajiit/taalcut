// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL (contract §2): where a reel's overlay sat, as an intent rather than coordinates, so a made video of
 * other footage and another shape can keep it: beside the speaker's head on the open side, in the sky over a
 * subject, or in the bottom third of the frame. The breakdown reads it from the reel's subjects (FRM1-SUB's
 * `template.subjects`) and records it on the overlay's design; timeline's placement solver keeps it and never
 * covers a head. A design from before FRM1 has none: the solver reads the relation from the overlay's box then.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const OVERLAY_PLACEMENT_ANCHORS = ['subject', 'frame'] as const;
export const OVERLAY_PLACEMENT_SIDES = ['left', 'right', 'above', 'below'] as const;
export const OVERLAY_PLACEMENT_ZONES = ['top', 'middle', 'bottom'] as const;
export type OverlayPlacementSide = (typeof OVERLAY_PLACEMENT_SIDES)[number];
export type OverlayPlacementZone = (typeof OVERLAY_PLACEMENT_ZONES)[number];

export const overlayPlacementSchema = z.object({
  /** 'subject': the overlay sat beside a person's head in the reel; 'frame': it sat in a band of the frame. */
  relativeTo: z.enum(OVERLAY_PLACEMENT_ANCHORS),
  /** relativeTo 'subject': which side of the subject's head the overlay sat on in the reel. */
  side: z.enum(OVERLAY_PLACEMENT_SIDES).optional(),
  /** The vertical band in the reel: where it sits when relativeTo is 'frame', and a tie-break otherwise. */
  zone: z.enum(OVERLAY_PLACEMENT_ZONES),
  /** Gap from the head box, as a share of the head's height (relativeTo 'subject'). */
  gap: z.number().min(0).max(10).optional(),
});
export type OverlayPlacement = z.output<typeof overlayPlacementSchema>;
