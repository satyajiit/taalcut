// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the bundled faces as the text-design tools list them (timeline's `timeline.textLook`): each face's id, the
 * family it is called, its class, and the lightest and heaviest weight its files draw. Read from the lock and the
 * categories, so a face added there is offered here.
 */
import { CAPTION_FONTS } from '@taalcut/core';
import { familyOf, filesOf, FONT_CATEGORY, weightRange, type FontCategory } from './fonts';
import type { CaptionFontId } from '../types';

export interface TextFaceInfo {
  readonly id: CaptionFontId;
  readonly family: string;
  readonly class: FontCategory;
  readonly weights: readonly [number, number];
}

export function textFaces(): TextFaceInfo[] {
  return CAPTION_FONTS.map((id) => {
    const ranges = filesOf(id).map(weightRange);
    return {
      id,
      family: familyOf(id),
      class: FONT_CATEGORY[id],
      weights: [Math.min(...ranges.map((range) => range[0])), Math.max(...ranges.map((range) => range[1]))],
    };
  });
}
