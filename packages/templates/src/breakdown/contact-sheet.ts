// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The kept contact sheet (SPEC "Contact sheet"): one tile per slot (its
 * middle frame), at most 60, 180 px on the long side, JPEG quality 70. It is
 * the only image of the reference that outlives the breakdown.
 */
import type { Canvas } from '@taalcut/core';
import type { BreakdownConfig } from './config';

export interface SheetLayout {
  readonly columns: number;
  readonly rows: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}

const even = (value: number) => Math.max(16, Math.round(value / 2) * 2);

export function sheetLayout(
  tiles: number,
  canvas: Pick<Canvas, 'width' | 'height'>,
  config: BreakdownConfig['contactSheet'],
): SheetLayout {
  const count = Math.max(1, tiles);
  let columns = Math.min(config.maxColumns, Math.ceil(Math.sqrt(count)));
  if (Math.ceil(count / columns) > 10) columns = Math.min(10, Math.ceil(count / 10));
  const rows = Math.ceil(count / columns);
  const long = config.tileLongSide;
  const portrait = canvas.height >= canvas.width;
  const tileWidth = portrait ? even((long * canvas.width) / canvas.height) : long;
  const tileHeight = portrait ? long : even((long * canvas.height) / canvas.width);
  return { columns, rows, tileWidth: Math.min(180, tileWidth), tileHeight: Math.min(180, tileHeight) };
}

/** Each shot's middle frame; with more shots than tiles, an even spread of them. */
export function tileFrames(
  shots: readonly { readonly start: number; readonly end: number }[],
  maxTiles: number,
): number[] {
  const middles = shots.map((shot) => Math.floor((shot.start + shot.end - 1) / 2));
  if (middles.length <= maxTiles) return middles;
  return Array.from({ length: maxTiles }, (_, i) => middles[Math.floor((i * middles.length) / maxTiles)]!);
}
