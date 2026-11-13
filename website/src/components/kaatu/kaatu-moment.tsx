// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Kaatu moment · mode: Persuade (brand moment) · system: WEB2 Remix Vernacular
 * states (moods, from the prop or a KaatuMoodProvider): idle (breath, blinks, an antic now and then, dozes when nothing
 *   happens) · glance (looks toward the field and blinks there) · thinking (looks up one way, nibbles, the other way,
 *   a beat a second) · delighted (a heart and a hop, then content) · oops (surprised with a droop, then content) ·
 *   asleep (nods off, slower breath) · wave (waves, then idle) · off screen (stopped) · reduced motion (one still
 *   frame per mood) · without JavaScript (that still frame)
 * Kaatu beside words: the Kaatu API (kaatu.tsx) in a mood, at one of four sizes, pulled in on both sides by the app's
 * optical inset (18 %: the drawing fills about the middle 60 % of its cell), so the drawing, not the empty cell, lines
 * up with a column's edge. Decorative: aria-hidden, never focusable. */

import { cn } from '#lib/cn';
import { Kaatu } from './kaatu';
import type { KaatuMood, KaatuToward } from './kaatu-moods';

export type { KaatuMood, KaatuToward };

export interface KaatuMomentProps {
  readonly mood?: KaatuMood;
  /** Rendered size in px. */
  readonly size?: 48 | 64 | 96 | 112;
  /** Where a glance looks: toward the words or the field beside Kaatu. */
  readonly toward?: KaatuToward;
  readonly className?: string;
}

const INSET = {
  48: '-mx-[9px]',
  64: '-mx-[12px]',
  96: '-mx-[17px]',
  112: '-mx-[20px]',
} as const;

export function KaatuMoment({ mood, size = 64, toward = 'right', className }: KaatuMomentProps) {
  return <Kaatu {...(mood ? { mood } : {})} size={size} toward={toward} className={cn('relative', INSET[size], className)} />;
}
