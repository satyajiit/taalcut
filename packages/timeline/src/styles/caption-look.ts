// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A timeline's caption look from a Style or one of render's presets (P3-V3 caption axis, P3-V16): the captions'
 * words and timing stay, only `style` changes, and `styleSource` says where the look came from. A timeline
 * without captions has no look to change. A Style's own look is @taalcut/templates' `captionStyleOf`.
 */
import { isDeepStrictEqual } from 'node:util';
import {
  CAPTION_PRESET_IDS,
  CAPTION_PRESETS,
  type CaptionPresetId,
  type CaptionStyle,
  type CaptionTrack,
} from '@taalcut/core';

/** The captions with `style` as their look; the same object when nothing would change. */
export function withCaptionStyle(captions: CaptionTrack, style: CaptionStyle): CaptionTrack {
  if (captions.styleSource === 'preset' && isDeepStrictEqual(captions.style, style)) return captions;
  return { ...captions, style, styleSource: 'preset' };
}

/** The preset whose look the captions wear, if any (captions store the look, not the preset's id). */
export function captionPresetOf(captions: CaptionTrack | null): CaptionPresetId | null {
  if (!captions) return null;
  return CAPTION_PRESET_IDS.find((id) => isDeepStrictEqual(CAPTION_PRESETS[id], captions.style)) ?? null;
}
