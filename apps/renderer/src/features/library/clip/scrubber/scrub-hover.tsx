// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the frame under the pointer · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.5 · hovering the scrubber shows, over the filmstrip, the sprite frame nearest that moment (the
 *   filmstrip's own, made for this plate at 2×; round 2: never sampled from the video) on a raised plate with the
 *   moment's time in JetBrains Mono. Until the filmstrip is made the plate shows the time alone, never a stand-in
 * states: shown (under a pointer, not while dragging: the viewer shows the frame then) · frame arriving (the plate's
 *   viewer grey until the sprite has loaded) · time only (no filmstrip yet) · hidden · interactive n/a (it follows
 *   the pointer; it takes none)
 * motion: it appears by opacity over --dur-micro; it follows the pointer at once
 */
import type { Filmstrip } from '@taalcut/core';
import { useTimecode } from '@taalcut/ui';
import { useMemo } from 'react';
import { useMediaUrls } from '../../../../services/provider';
import { frameStyle, frameTimesMs, nearestFrame, useSpriteLoad } from './sprite';

const MS = { num: 1000, den: 1 } as const;
/** The plate's frame height (px): the filmstrip's frames are twice this. */
const FRAME_HEIGHT = 96;

export interface ScrubHoverProps {
  /** Where the pointer is: px from the lanes' left edge, and the moment there; null when it isn't over them. */
  hover: { readonly x: number; readonly at: number } | null;
  /** The lanes' width (px), to keep the plate inside. */
  width: number;
  /** The clip's filmstrip, once media.filmstrip made it. */
  filmstrip: Filmstrip | null;
  ratio: number;
}

export function ScrubHover({ hover, width, filmstrip, ratio }: ScrubHoverProps) {
  const timecode = useTimecode();
  const media = useMediaUrls();
  const src = filmstrip ? media.derived(filmstrip.file) : null;
  const load = useSpriteLoad(src);
  const times = useMemo(() => (filmstrip ? frameTimesMs(filmstrip) : []), [filmstrip]);
  const frameWidth = Math.round(FRAME_HEIGHT * Math.min(16 / 9, Math.max(9 / 16, ratio)));
  const at = hover?.at ?? null;
  const frame = filmstrip && src && load !== 'broken' && at !== null ? nearestFrame(times, at) : null;
  // Centred on the pointer, kept inside the lanes: percentages are the plate's own width, whatever it holds.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS length, never shown
  const left = hover ? `clamp(0px, ${hover.x}px - 50%, ${width}px - 100%)` : '0px';

  return (
    <div
      aria-hidden
      data-slot="clip-scrub-hover"
      data-shown={hover !== null || undefined}
      className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-0 z-20 flex flex-col items-center gap-1 rounded-md bg-raised p-1 opacity-0 shadow-lg transition-opacity duration-(--dur-micro) ease-(--ease-out) data-[shown]:opacity-100"
      style={{ transform: `translateX(${left})` }}
    >
      {filmstrip && src && frame !== null ? (
        <span
          data-frame={frame}
          className="relative block overflow-hidden rounded-sm bg-viewer"
          style={{ width: frameWidth, height: FRAME_HEIGHT }}
        >
          <span
            data-ready={load === 'ready' || undefined}
            className="absolute inset-0 opacity-0 data-[ready]:opacity-100"
            style={frameStyle(filmstrip, src, frame, { width: frameWidth, height: FRAME_HEIGHT })}
          />
        </span>
      ) : null}
      <span className="px-1 font-mono text-2xs text-ink tabular-nums">
        {at === null ? ' ' : timecode.clock(Math.round(at), MS, { fraction: true })}
      </span>
    </div>
  );
}
