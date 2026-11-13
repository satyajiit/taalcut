// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useRef, type PointerEvent, type RefObject } from 'react';
import type { Playhead } from './playhead';
import { visibleTimelineFrame } from './timeline-viewport';

export function usePlayheadScrub(
  playhead: Playhead,
  scroller: RefObject<HTMLDivElement | null>,
  pxPerFrame: number,
  total: number,
) {
  const pointer = useRef<number | null>(null);
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const box = scroller.current;
    if (!box || pointer.current !== event.pointerId) return;
    playhead.seek(
      visibleTimelineFrame(
        event.clientX,
        {
          left: box.getBoundingClientRect().left,
          width: box.clientWidth,
          scrollLeft: box.scrollLeft,
        },
        pxPerFrame,
        total,
      ),
    );
  };
  const cancel = () => {
    pointer.current = null;
  };
  return {
    pointer,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        if (playhead.playing()) playhead.pause();
        pointer.current = event.pointerId;
      },
      onPointerMove: seek,
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (pointer.current !== event.pointerId) return;
        seek(event);
        cancel();
        event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    },
  };
}
