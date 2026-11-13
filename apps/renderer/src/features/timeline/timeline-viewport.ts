// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Captured pointers can leave the scroller; keep the seek inside the visible part of the timeline. */
export function visibleTimelineFrame(
  clientX: number,
  viewport: { readonly left: number; readonly width: number; readonly scrollLeft: number },
  pxPerFrame: number,
  total: number,
): number {
  const inset = Math.min(7, viewport.width / 2);
  // Bound whole frames: rounding a bounded pixel position can put the handle outside again at high zoom.
  const first = viewport.scrollLeft === 0 ? 0 : Math.ceil((viewport.scrollLeft + inset) / pxPerFrame);
  const last = Math.max(
    0,
    Math.min(total - 1, Math.floor((viewport.scrollLeft + viewport.width - inset) / pxPerFrame)),
  );
  const frame = Math.round((viewport.scrollLeft + clientX - viewport.left) / pxPerFrame);
  return Math.min(last, Math.max(first, frame));
}
