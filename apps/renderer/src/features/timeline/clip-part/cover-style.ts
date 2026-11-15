// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: one frame of a filmstrip sprite as a box's background, in shares of the box, so the box can be any size
 * its layout gives it and needs no measuring (the Library's `frameStyle` wants the box in px).
 */
import type { Filmstrip } from '@taalcut/core';
import type { CSSProperties } from 'react';

const percent = (share: number) => `${Math.round(share * 100_000) / 1000}%`;

/** The sprite showing frame `index`, covering a box of shape `shape` (width over height). */
export function coverStyle(filmstrip: Filmstrip, src: string, index: number, shape: number): CSSProperties {
  const { columns, rows, tileWidth, tileHeight } = filmstrip;
  const tile = tileWidth / tileHeight;
  // One frame's width and height, in box widths and box heights.
  const width = tile >= shape ? tile / shape : 1;
  const height = tile >= shape ? 1 : shape / tile;
  const x = (1 - width) / 2 - (index % columns) * width;
  const y = (1 - height) / 2 - Math.floor(index / columns) * height;
  // A background's place in percent is a share of the room the box has left over (which is negative here).
  const [roomX, roomY] = [1 - columns * width, 1 - rows * height];
  return {
    backgroundImage: `url("${src}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${percent(columns * width)} ${percent(rows * height)}`,
    backgroundPosition: `${percent(roomX ? x / roomX : 0)} ${percent(roomY ? y / roomY : 0)}`,
  };
}
