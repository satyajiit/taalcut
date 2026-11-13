// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { TIMELINE_COMMANDS } from '@taalcut/core';
import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { TextView, TimelineModel } from './model';
import type { Edits } from './use-edits';

type Edge = 'start' | 'end';
interface TextDrag {
  text: TextView;
  edge: Edge;
  pointerId: number;
  x: number;
  scroll: number;
  to: { start: number; end: number };
}

export function useTextTimingDrag(
  model: TimelineModel,
  pxPerFrame: number,
  edits: Edits,
  scroller?: RefObject<HTMLDivElement | null>,
) {
  const current = useRef<TextDrag | null>(null);
  const [drag, setDrag] = useState<TextDrag | null>(null);
  const cancel = () => {
    current.current = null;
    setDrag(null);
  };
  const start = (text: TextView, event: PointerEvent<HTMLDivElement>) => {
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-trim-edge]')?.dataset.trimEdge;
    if (edits.pending || event.button !== 0 || (edge !== 'start' && edge !== 'end')) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next: TextDrag = {
      text,
      edge,
      pointerId: event.pointerId,
      x: event.clientX,
      scroll: scroller?.current?.scrollLeft ?? 0,
      to: { start: text.start, end: text.end },
    };
    current.current = next;
    setDrag(next);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const now = current.current;
    if (!now || now.pointerId !== event.pointerId) return;
    const dx = event.clientX - now.x + (scroller?.current?.scrollLeft ?? 0) - now.scroll;
    const delta = Math.round(dx / pxPerFrame);
    const to =
      now.edge === 'start'
        ? { start: Math.max(0, Math.min(now.text.end - 1, now.text.start + delta)), end: now.text.end }
        : {
            start: now.text.start,
            end: Math.max(now.text.start + 1, Math.min(model.total, now.text.end + delta)),
          };
    current.current = { ...now, to };
    setDrag(current.current);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    move(event);
    const now = current.current;
    if (!now || now.pointerId !== event.pointerId) return;
    cancel();
    if (now.to.start === now.text.start && now.to.end === now.text.end) return;
    void edits.command(TIMELINE_COMMANDS.editText, {
      itemId: now.text.item.id,
      start: { value: now.to.start, rate: model.rate },
      duration: { value: now.to.end - now.to.start, rate: model.rate },
    });
  };
  return { drag, start, move, finish, cancel };
}
