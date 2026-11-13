// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TemplateSummarySheet } from '@taalcut/core';
import type { CSSProperties } from 'react';

/**
 * One tile of a template's contact sheet as a box's background, drawn at `width` × `height` (the sheet's tiles are
 * scaled to that size). The first tile by default. Without a URL the box keeps its own (viewer-grey) background.
 */
/** Two lengths in pixels, as a CSS pair ("12px 34px"). */
const pixels = (x: number, y: number) => [`${x}px`, `${y}px`].join(' ');

export function sheetTileStyle(
  sheet: Pick<TemplateSummarySheet, 'columns' | 'rows'>,
  url: string | null,
  width: number,
  height: number,
  index = 0,
): CSSProperties {
  if (!url) return { width, height };
  const column = index % sheet.columns;
  const row = Math.floor(index / sheet.columns);
  return {
    width,
    height,
    backgroundImage: `url("${url}")`,
    backgroundSize: pixels(sheet.columns * width, sheet.rows * height),
    backgroundPosition: pixels(-column * width, -row * height),
  };
}

/**
 * One tile of the sheet filling its box, whatever the box's size (percentages, so no measuring): a slot's frame on
 * the review's stage when the reel can't play. The box should have the tile's shape.
 */
export function sheetTileFill(
  sheet: Pick<TemplateSummarySheet, 'columns' | 'rows'>,
  url: string | null,
  index: number,
): CSSProperties {
  if (!url) return {};
  const column = index % sheet.columns;
  const row = Math.floor(index / sheet.columns);
  const at = (i: number, n: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: `${at(column, sheet.columns)}% ${at(row, sheet.rows)}%`,
  };
}
