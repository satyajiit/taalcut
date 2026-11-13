// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bounds profileOf (LRN1-STY) sorts into core's vocabularies. Part of the algorithm: a change here is a new
 * STYLE_PROFILE_ALGORITHM in core, so every stored profile rebuilds.
 */
export const PROFILE_CONFIG = {
  /** "Shots in the first 3 s": slots that start before this. */
  openingSeconds: 3,
  /** Cap height as a share of the canvas height: small below the first bound, medium below the second. */
  textSize: { small: 0.025, medium: 0.045 },
  /** A canvas is one of the common shapes when its width/height is within this share of it. */
  aspectTolerance: 0.02,
  /** Characters kept of each example hook text (the rest is cut at a word boundary). */
  exampleChars: 120,
  /** How many exemplars for a set of n members: one per this many members, between 1 and 3. */
  membersPerExemplar: 4,
} as const;
