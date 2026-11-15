// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: how a reel sets the letters of an overlay, measured from its pixels and recorded on the overlay's design
 * (`design.type`), beside what BRK1 already reads (the letters' colour in `colors.text`, their weight in
 * `font.weight`, how they come on in `motion.enter`). The breakdown measures what pixels can say: the letters'
 * stem for their height, whether they carry an outline (its colour is `colors.stroke`) and how wide it is, a dark
 * soft edge under them, how wide they are set and how far apart. What needs an eye (a serif, a script, a
 * typewriter face) is `font.class`, which stays the pixels' guess until something that sees states it. A design
 * from before TXT1 has no `type`; nothing reads one as "no outline".
 */
import '../basics/zod-config';
import { z } from 'zod';

/** How wide letters are set for their height: a condensed face, an ordinary one, an extended one. */
export const OVERLAY_TYPE_WIDTHS = ['condensed', 'normal', 'wide'] as const;
export type OverlayTypeWidth = (typeof OVERLAY_TYPE_WIDTHS)[number];

export const overlayTypeSchema = z.object({
  /** The letters' stem as a share of their height: what `font.weight` is read from. */
  stem: z.number().min(0).max(1),
  /** The outline round the letters as a share of their height; null when they have none. */
  outline: z.number().min(0).max(0.5).nullable(),
  /** A dark soft edge under or round the letters (a drop shadow), with or without an outline. */
  shadow: z.boolean(),
  /** Null when the letters couldn't be told apart (they touch, as tight heavy faces do): no width is claimed. */
  width: z.enum(OVERLAY_TYPE_WIDTHS).nullable(),
  /** The gap between letters as a share of their height; null when fewer than two letters could be told apart. */
  spacing: z.number().min(0).max(2).nullable(),
  /** How sure the measure is: fewer still frames, small letters and a busy picture lower it. */
  confidence: z.number().min(0).max(1),
});
export type OverlayType = z.output<typeof overlayTypeSchema>;
