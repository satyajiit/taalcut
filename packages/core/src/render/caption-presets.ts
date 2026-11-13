// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The caption looks offered without a reference (P3-V16, P3-V3): render's data, in core because the timeline
 * applies them (batch, variants) without importing render. Render clamps `anchorY` into the export preset's safe
 * rect, and Devanagari captions swap the font for the curated one of the same kind that covers the script.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { CaptionStyle } from './captions';

export const CAPTION_PRESET_IDS = ['classic', 'bold', 'boxed', 'karaoke', 'minimal'] as const;
export const captionPresetIdSchema = z.enum(CAPTION_PRESET_IDS);
export type CaptionPresetId = z.output<typeof captionPresetIdSchema>;

const black = '#000000';
const white = '#ffffff';
const yellow = '#ffd400';
const common = { version: 1, textColor: white, letterCase: 'asIs', anchorY: 0.58, maxLines: 2 } as const;

export const CAPTION_PRESETS: Readonly<Record<CaptionPresetId, CaptionStyle>> = {
  classic: {
    ...common,
    font: 'poppins',
    weight: 800,
    sizePx: 72,
    highlightColor: yellow,
    stroke: { color: black, widthPx: 4 },
    background: null,
    highlight: 'color',
    maxWords: 4,
  },
  bold: {
    ...common,
    font: 'anton',
    weight: 400,
    sizePx: 96,
    highlightColor: yellow,
    stroke: { color: black, widthPx: 6 },
    background: null,
    highlight: 'pop',
    letterCase: 'upper',
    maxWords: 3,
  },
  boxed: {
    ...common,
    font: 'montserrat',
    weight: 700,
    sizePx: 64,
    highlightColor: yellow,
    stroke: null,
    background: { color: black, opacity: 0.7, paddingPx: 12, radiusPx: 8 },
    highlight: 'box',
    maxWords: 5,
  },
  karaoke: {
    ...common,
    font: 'poppins',
    weight: 700,
    sizePx: 68,
    highlightColor: '#00e5ff',
    stroke: { color: black, widthPx: 3 },
    background: null,
    highlight: 'color',
    maxWords: 6,
  },
  minimal: {
    ...common,
    font: 'notoSans',
    weight: 600,
    sizePx: 56,
    highlightColor: white,
    stroke: { color: black, widthPx: 2 },
    background: null,
    highlight: 'none',
    maxWords: 7,
  },
};
