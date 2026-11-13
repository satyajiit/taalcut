// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Captions never cover a face (SPEC P3.2). Where the crop can't move the face above the caption band (16:9
 * footage on 9:16 uses the full height), each cue whose box would overlap a face during the cue is moved, at
 * compile time, to the nearest place inside the safe rect that clears every face: below the face first, then
 * above. Only those cues move, and the move is computed, never stored, so it follows edits. Pure; canvas
 * pixels.
 */
import type { Rect } from '@taalcut/core';
import type { FrameSpan } from '../plan/types';
import { REFRAME_CONFIG } from './config';

export interface DodgeCue {
  readonly id: string;
  readonly span: FrameSpan;
  /** The cue's box as laid out at the style's anchor. */
  readonly box: Rect;
}

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A cue's new top that clears `faces` inside `safe`, or null when no place does. */
export function clearTop(box: Rect, faces: readonly Rect[], safe: Rect, gapPx: number): number | null {
  const hits = faces.filter((face) => rectsOverlap(face, box));
  if (hits.length === 0) return box.y;
  const fits = (top: number) =>
    top >= safe.y &&
    top + box.height <= safe.y + safe.height &&
    faces.every((face) => !rectsOverlap(face, { ...box, y: top }));
  const below = Math.max(...hits.map((face) => face.y + face.height)) + gapPx;
  if (fits(below)) return below;
  const above = Math.min(...hits.map((face) => face.y)) - gapPx - box.height;
  if (fits(above)) return above;
  return null;
}

/**
 * New tops for the cues a face would sit under. `facesDuring` gives the face boxes on the canvas over a cue's
 * frames; a cue that no place clears keeps its anchor (QA's captionCoversFace then reports it).
 */
export function dodgeCaptions(
  cues: readonly DodgeCue[],
  facesDuring: (span: FrameSpan) => readonly Rect[],
  safe: Rect,
  gapPx: number = REFRAME_CONFIG.captionGapPx,
): Map<string, { readonly topPx: number }> {
  const moved = new Map<string, { topPx: number }>();
  for (const cue of cues) {
    const faces = facesDuring(cue.span);
    if (!faces.some((face) => rectsOverlap(face, cue.box))) continue;
    const top = clearTop(cue.box, faces, safe, gapPx);
    if (top !== null && top !== cue.box.y) moved.set(cue.id, { topPx: Math.round(top) });
  }
  return moved;
}
