// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The caption look a Style contributes to `timeline.captions.style` (P3-V10). */
import type { CaptionStyle, Style } from '@taalcut/core';

export function captionStyleOf(style: Style): CaptionStyle | null {
  return style.captions;
}
