// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { EDIT_GRAPHIC } from '@taalcut/ui';
import { useRef, useState, type PointerEvent } from 'react';
import { useCommand } from '../../backend/use-command';
import { useEditorContext } from './editor-context';
import { dragEdit, dragged, type GraphicDragMode, type GraphicView } from './graphics-lane-model';

interface GraphicDrag {
  readonly view: GraphicView;
  readonly mode: GraphicDragMode;
  readonly pointerId: number;
  readonly startX: number;
  readonly moving: boolean;
  readonly to: { start: number; end: number };
}

/** Keep transient pointer state separate from the one undoable command sent on release. */
export function useGraphicTimingDrag(pxPerFrame: number) {
  const editor = useEditorContext();
  const command = useCommand();
  const [drag, setDrag] = useState<GraphicDrag | null>(null);
  const gesture = useRef<GraphicDrag | null>(null);

  const edit = (view: GraphicView, to: { start: number; end: number }) => {
    if (!editor) return;
    const change = dragEdit(view, to, editor.model.rate);
    if (!change) return;
    void command.run({
      name: EDIT_GRAPHIC,
      payload: {
        projectId: editor.projectId,
        timelineId: editor.timeline.id,
        itemId: view.item.id,
        ...change,
      },
    });
  };
  const cancel = () => {
    gesture.current = null;
    setDrag(null);
  };
  const start = (view: GraphicView, event: PointerEvent<HTMLDivElement>) => {
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-trim-edge]')?.dataset.trimEdge;
    const mode = edge === 'start' || edge === 'end' ? edge : 'move';
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    gesture.current = {
      view,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      moving: false,
      to: { start: view.start, end: view.end },
    };
    setDrag(gesture.current);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!editor || !current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.startX;
    if (!current.moving && Math.abs(dx) < 4) return;
    const to = dragged(
      current.view,
      current.mode,
      Math.round(dx / pxPerFrame),
      editor.model.total,
      editor.model.rate,
    );
    gesture.current = { ...current, moving: true, to };
    setDrag(gesture.current);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    move(event);
    const finished = gesture.current;
    cancel();
    if (finished?.moving) edit(finished.view, finished.to);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { drag, edit, start, move, finish, cancel };
}
