// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Words for looks (P3-V10, P3-V16) that more than one screen says: render's caption presets, the curated
 * fonts by their own names, and what a batch skipped and why.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { CaptionPresetId, FontMatchFamily } from '@taalcut/core';

/** Render's caption presets (CAPTION_PRESETS), as the Look menus and the batch card name them. */
export const CAPTION_PRESET_LABELS: Readonly<Record<CaptionPresetId, MessageDescriptor>> = {
  classic: msg({ id: 'looks.captionPresets.classic', message: 'Classic captions' }),
  bold: msg({ id: 'looks.captionPresets.bold', message: 'Bold captions' }),
  boxed: msg({ id: 'looks.captionPresets.boxed', message: 'Boxed captions' }),
  karaoke: msg({ id: 'looks.captionPresets.karaoke', message: 'Karaoke captions' }),
  minimal: msg({ id: 'looks.captionPresets.minimal', message: 'Minimal captions' }),
};

/* eslint-disable lingui/no-unlocalized-strings -- typeface names: proper names, the same in every language */
/** Every face a Style or a font match may name, by its own name. */
export const FONT_NAMES: Readonly<Record<FontMatchFamily, string>> = {
  notoSans: 'Noto Sans',
  notoSansDevanagari: 'Noto Sans Devanagari',
  poppins: 'Poppins',
  mukta: 'Mukta',
  hind: 'Hind',
  baloo2: 'Baloo 2',
  montserrat: 'Montserrat',
  anton: 'Anton',
  bebasNeue: 'Bebas Neue',
  inter: 'Inter',
  sourceSans3: 'Source Sans 3',
  sourceSerif4: 'Source Serif 4',
  lora: 'Lora',
  merriweather: 'Merriweather',
  libreFranklin: 'Libre Franklin',
  nunito: 'Nunito',
  ibmPlexSans: 'IBM Plex Sans',
  tiroDevanagariHindi: 'Tiro Devanagari Hindi',
  martel: 'Martel',
  kalam: 'Kalam',
};

/** A CSS font stack for a face: its own name first, the app's sans after (the page bundles none of them). */
export function fontStack(family: FontMatchFamily): string {
  return `"${FONT_NAMES[family]}", var(--font-sans)`;
}
/* eslint-enable lingui/no-unlocalized-strings */
