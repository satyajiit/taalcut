// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tracked line becomes a TextOverlay with timing, position and a guess at
 * its look: role from size, place and wording; size from the box; alignment
 * from the box's centre; case from the letters. The slot it starts in is set
 * when the slots are known (build-template.ts). The text is the reference's,
 * untrusted: kept and shown as plain text only (PRD 7.2).
 */
import { languageTagSchema, RationalTime, type FrameRate, type TextOverlay } from '@taalcut/core';
import type { TextRole } from '../types';
import type { TextTrack } from './text-track';

const CTA = /\b(follow|subscribe|link in bio|comment|save this|share|like)\b/i;
const MAX_TEXT = 500;

function roleOf(track: TextTrack): TextRole {
  if (CTA.test(track.text)) return 'cta';
  if (track.box.height >= 0.06) return 'title';
  if (track.box.y + track.box.height / 2 > 0.6) return 'caption';
  return 'label';
}

function caseOf(text: string): TextOverlay['appearance']['case'] {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0 || letters.toLowerCase() === letters.toUpperCase()) return 'mixed';
  if (letters === letters.toUpperCase()) return 'upper';
  return letters === letters.toLowerCase() ? 'lower' : 'mixed';
}

function alignOf(track: TextTrack): TextOverlay['appearance']['align'] {
  const centre = track.box.x + track.box.width / 2;
  return centre < 0.4 ? 'left' : centre > 0.6 ? 'right' : 'center';
}

/** A tag core's schema accepts, or null (OCR engines report 'en-US', 'hi', 'zh-Hans', …). */
function language(tag: string | null): string | null {
  return tag !== null && languageTagSchema.safeParse(tag).success ? tag : null;
}

export function overlayFromTrack(
  track: TextTrack,
  timing: { readonly start: number; readonly end: number; readonly rate: FrameRate },
  id: TextOverlay['id'],
): TextOverlay {
  const role = roleOf(track);
  const box = {
    x: Math.min(1, Math.max(0, track.box.x)),
    y: Math.min(1, Math.max(0, track.box.y)),
    width: 0,
    height: 0,
  };
  box.width = Math.min(1 - box.x, Math.max(0, track.box.width));
  box.height = Math.min(1 - box.y, Math.max(0, track.box.height));
  return {
    id,
    text: track.text.trim().slice(0, MAX_TEXT),
    role,
    start: RationalTime.of(timing.start, timing.rate),
    duration: RationalTime.of(Math.max(1, timing.end - timing.start), timing.rate),
    slotId: null,
    box,
    appearance: {
      // Cap height is roughly 70% of a line box.
      size: Math.min(0.5, Math.max(0.005, track.box.height * 0.7)),
      align: alignOf(track),
      case: caseOf(track.text),
      // OCR can't see backgrounds; the Analyst or the user may correct it.
      background: 'none',
    },
    styleKey: role,
    reveal: track.wordByWord ? 'wordByWord' : 'none',
    language: language(track.language),
    confidence: Math.min(1, Math.max(0, track.confidence)),
  };
}
