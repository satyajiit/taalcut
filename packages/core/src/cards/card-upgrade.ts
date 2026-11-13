// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stored cards in a shape a contract round wrote before any build shipped it, read as today's. A shape a build
 * shipped gets a version 2 instead (SPEC section 9, "Versions"). Round P3-1's motionGraphic card kept its place in
 * milliseconds (`startMs`, `durationMs`); they read as `start` and `duration` at 1000/1, exactly. Its voiceover
 * card's lines upgrade in voiceLineSchema itself.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { fromMilliseconds } from '../time/milliseconds';

const p31MotionGraphic = z.looseObject({
  type: z.literal('motionGraphic'),
  startMs: z.int().nonnegative(),
  durationMs: z.int().positive(),
});

/** The card as today's schema reads it; anything else comes back unchanged for parseCard to judge. */
export function upgradeStoredCard(value: unknown): unknown {
  const old = p31MotionGraphic.safeParse(value);
  if (!old.success) return value;
  const { startMs, durationMs, ...card } = old.data;
  return { ...card, start: fromMilliseconds(startMs), duration: fromMilliseconds(durationMs) };
}
