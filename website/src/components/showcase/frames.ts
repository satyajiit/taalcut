// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CSSProperties } from 'react';
import { CAMERA_ROLL, ROLL_FRAMES } from '#content/reels';

/**
 * Where a clip's pictures sit in the camera roll's sprite atlas (the owner's own footage, #content/reels). A clip id
 * the roll doesn't have has no frames, and the showcases draw DESIGN.md's empty frame for it instead of a dark tile.
 */

/** How often the atlas holds a frame of a clip, in seconds (scripts/media.mjs cuts one every 0.2 s). */
const FRAME_EVERY = 0.2;

/** Every frame the atlas holds of a clip, in time order; none for a clip the roll doesn't have. */
export function framesOf(clipId: string | undefined): readonly number[] {
  if (!clipId) return [];
  const own = ROLL_FRAMES.filter((f) => f.clipId === clipId)
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((f) => f.sprite);
  if (own.length > 0) return own;
  const clip = CAMERA_ROLL.clips.find((c) => c.id === clipId);
  return clip ? [clip.sprite] : [];
}

/** The frame a clip shows at rest (the one media.mjs chose for it), or undefined when it has no footage. */
export function frameOf(clipId: string | undefined): number | undefined {
  if (!clipId) return undefined;
  return CAMERA_ROLL.clips.find((c) => c.id === clipId)?.sprite ?? framesOf(clipId)[0];
}

/** The frame `seconds` into a clip: its frames in turn, one every 0.2 s, round again at the end. */
export function frameAtTime(clipId: string | undefined, seconds: number): number | undefined {
  const frames = framesOf(clipId);
  if (frames.length === 0) return undefined;
  const step = Math.max(0, Math.floor(seconds / FRAME_EVERY));
  return frames[step % frames.length];
}

/** How many 9:16 frames a filmstrip needs to fill `share` of a lane that holds `across` frames end to end. */
export function filmstripCount(share: number, across: number): number {
  return Math.max(1, Math.ceil(Math.max(0, share) * across) + 1);
}

/**
 * One frame cut from the atlas, sized to its box: background-size and position in percentages, so a 9:16 box shows
 * exactly one 9:16 cell (the same arithmetic as the hero's components/demo/roll.ts, kept here as the lane's own copy).
 */
export function spriteStyle(sprite: number, atlas = CAMERA_ROLL.atlas): CSSProperties {
  const { columns, rows } = atlas;
  const index = Math.max(0, Math.min(sprite, columns * rows - 1));
  const x = columns > 1 ? ((index % columns) / (columns - 1)) * 100 : 0;
  const y = rows > 1 ? (Math.floor(index / columns) / (rows - 1)) * 100 : 0;
  return {
    backgroundImage: `url(${atlas.src})`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: 'no-repeat',
  };
}
