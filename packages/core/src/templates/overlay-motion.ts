// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-GFX: how a reel's overlay comes on and goes off, read from its frames (templates' overlay-look). `none` is a
 * cut: gone on one frame, all there on the next. HFW1: `unknown` is a reading the frames can't decide (the frame
 * before the appearance wasn't read, or the overlay is there from the reel's first frame), kept apart from a cut so
 * a design never copies a cut the reel may not have.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const OVERLAY_ENTRANCES = [
  'none',
  'fade',
  'pop',
  'slide',
  'typewriter',
  'wordByWord',
  'unknown',
] as const;
export const OVERLAY_EXITS = ['none', 'fade', 'pop', 'slide', 'unknown'] as const;

export const overlayMotionSchema = z.object({
  enter: z.enum(OVERLAY_ENTRANCES),
  exit: z.enum(OVERLAY_EXITS),
  /** A typing indicator (three dots) shows before the words. */
  typing: z.boolean(),
});

export type OverlayEntrance = (typeof OVERLAY_ENTRANCES)[number];
export type OverlayExit = (typeof OVERLAY_EXITS)[number];
