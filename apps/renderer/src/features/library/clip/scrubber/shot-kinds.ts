// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A shot's kind as the clip page colours it (DESIGN.md v0.5, UX2): by how far the camera is, four families, each
 * an accent as a data mark with its word beside it (never the colour alone). Far shots (wide, aerial) teal, the
 * middle distance (medium, first person) violet, near (close-up, detail) rose, and pictures of pictures (a screen,
 * a text card) neutral ink. The chip's dot and the shot's edge under the filmstrip use it; nothing else does.
 */
import type { ShotType } from '@taalcut/core';
import { cn } from '@taalcut/ui';

export type ShotFamily = 'far' | 'middle' | 'near' | 'graphic';

export const SHOT_FAMILY: Readonly<Record<ShotType, ShotFamily>> = {
  wide: 'far',
  aerial: 'far',
  medium: 'middle',
  pov: 'middle',
  close: 'near',
  detail: 'near',
  screen: 'graphic',
  text: 'graphic',
};

/** The family's mark: a dot in a chip, and the 2 px edge under the shot's frames. */
export const FAMILY_MARK: Readonly<Record<ShotFamily | 'unknown', string>> = {
  far: cn('bg-teal-strong'),
  middle: cn('bg-violet-strong'),
  near: cn('bg-rose-strong'),
  graphic: cn('bg-ink-2'),
  unknown: cn('bg-rule-strong'),
};

export function shotMark(type: ShotType | null | undefined): string {
  return FAMILY_MARK[type ? SHOT_FAMILY[type] : 'unknown'];
}
