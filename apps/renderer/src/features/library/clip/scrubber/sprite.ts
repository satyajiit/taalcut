// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drawing from the filmstrip sprite (UX2, round 2): which of its frames is nearest a moment, and the CSS that shows
 * one frame in a box, covering it and centred as object-fit: cover would (a box narrower than the clip's shape crops
 * its sides). The sprite loads once; every box shows it as its background, so nothing decodes the video to draw.
 */
import { RationalTime, type Filmstrip } from '@taalcut/core';
import { useEffect, useState, type CSSProperties } from 'react';

/** Each frame's time, in ms from the clip's start. */
export function frameTimesMs(filmstrip: Filmstrip): number[] {
  return filmstrip.times.map((time) => RationalTime.toSeconds(time) * 1000);
}

/** The index of the frame nearest `at` (ms); `times` ascending, never empty. */
export function nearestFrame(times: readonly number[], at: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((times[middle] ?? 0) < at) low = middle + 1;
    else high = middle;
  }
  const before = times[low - 1];
  return before !== undefined && at - before <= (times[low] ?? at) - at ? low - 1 : low;
}

const px = (value: number) => `${value}px`;

/** The sprite as a box's background, showing frame `index` covering a `width` × `height` box. */
export function frameStyle(
  filmstrip: Filmstrip,
  src: string,
  index: number,
  box: { readonly width: number; readonly height: number },
): CSSProperties {
  const { columns, rows, tileWidth, tileHeight } = filmstrip;
  const scale = Math.max(box.width / tileWidth, box.height / tileHeight);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = (box.width - tileWidth * scale) / 2 - column * tileWidth * scale;
  const y = (box.height - tileHeight * scale) / 2 - row * tileHeight * scale;
  return {
    backgroundImage: `url("${src}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: [columns * tileWidth * scale, rows * tileHeight * scale].map(px).join(' '),
    backgroundPosition: [x, y].map(px).join(' '),
  };
}

export type SpriteLoad = 'loading' | 'ready' | 'broken';

/** The sprite loaded once: `ready` when it has, `broken` when it couldn't (or there is no address for it). */
export function useSpriteLoad(src: string | null): SpriteLoad {
  const [loaded, setLoaded] = useState<{ readonly src: string; readonly state: SpriteLoad } | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live) setLoaded({ src, state: 'ready' });
    };
    image.onerror = () => {
      if (live) setLoaded({ src, state: 'broken' });
    };
    image.src = src;
    return () => {
      live = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);
  if (!src) return 'broken';
  return loaded?.src === src ? loaded.state : 'loading';
}
