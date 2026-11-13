// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Where an interactive Kaatu looks and leans, from the pointer. Pure, for the tests. */
import type { KaatuDirection } from './kaatu-frames';

/** Kaatu looks toward a pointer within `reach` px of its middle; inside `near` px it looks straight out. */
export const FOLLOW = { reach: 520, near: 28 } as const;

/** The lean toward the pointer, at most: a share of Kaatu's size in percent, and degrees. Eased in the rAF. */
export const LEAN = { shift: 3, turn: 4, ease: 0.16 } as const;

/** The way Kaatu's head points to look at (px, py) from its middle (cx, cy), or null when the pointer is too far. */
export function directionToward(cx: number, cy: number, px: number, py: number): KaatuDirection | null {
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (d > FOLLOW.reach) return null;
  if (d < FOLLOW.near) return 'center';
  // Eight ways, 45° each, starting from straight right and turning clockwise (screen y grows down).
  const ways: readonly KaatuDirection[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ways[Math.round((((angle % 360) + 360) % 360) / 45) % 8] ?? 'center';
}

/** How far to lean toward the pointer: [x %, y %, degrees], strongest close by, nothing out of reach. */
export function leanToward(cx: number, cy: number, px: number, py: number): readonly [number, number, number] {
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (d > FOLLOW.reach || d < 1) return [0, 0, 0];
  const pull = Math.min(1, d / 120) * (1 - d / FOLLOW.reach);
  return [(dx / d) * LEAN.shift * pull, (dy / d) * LEAN.shift * 0.5 * pull, (dx / d) * LEAN.turn * pull];
}
