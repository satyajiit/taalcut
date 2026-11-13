// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: video track (V1) · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * the clips edge to edge on the bed; one tab stop (a listbox): arrows move between clips and gaps, Home and End
 *   jump, ⌘← ⌘→ reorder, [ ] (or ⌥← ⌥→) trim the end by a beat, Return goes to the inspector (on a gap: its fixes),
 *   Escape lets go
 * pointer: press to select; drag the body to reorder (the others make room, the clip settles with a damped
 *   spring); drag an edge to trim (snaps to the nearest beat within 8 px, a marigold line shows the new cut)
 * states: see clip-block.tsx and gaps/gap-block.tsx (an empty slot, with "Fix this gap")
 * motion: FLIP on transform (DUR.short, ease-out), the dropped clip's spring; reduced motion: at once
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { MIN_CLIP_FRAMES, type TimelineItemId } from '@taalcut/core';
import { useTimecode } from '@taalcut/ui';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { GapBlock } from './gaps/gap-block';
import { ClipBlock } from './clip-block';
import { settle, useFlip } from './flip';
import { snapToBeat, type ClipView, type PositionView, type TimelineModel } from './model';
import { ProgramBlock } from './authored/program-block';
import type { Edits } from './use-edits';
import type { AiEditMark } from './ai-edit-marks';

const DRAG_PX = 4;
const SNAP_PX = 8;

export interface VideoTrackProps {
  model: TimelineModel;
  pxPerFrame: number;
  selectedClipId: TimelineItemId | null;
  selectedIds?: readonly TimelineItemId[];
  aiMarks?: ReadonlyMap<string, AiEditMark> | undefined;
  onPick?(id: TimelineItemId, shift: boolean, toggle: boolean): void;
  onSelect: (clipId: TimelineItemId | null) => void;
  pictureFor: (clip: ClipView) => string | null;
  edits: Edits;
  onOpenInspector: () => void;
}

interface Drag {
  readonly clipId: TimelineItemId;
  readonly pointerId: number;
  readonly startX: number;
  /** Where in the clip it was grabbed, px. */
  readonly grab: number;
  moving: boolean;
  target: number;
  /** The pointer's last x in the track, to keep the clip under it when the others move. */
  x: number;
}

interface Trim {
  readonly clip: ClipView;
  readonly edge: 'start' | 'end';
  readonly startX: number;
  readonly min: number;
  readonly max: number;
  cut: number;
}

const isClip = (position: PositionView): position is ClipView => position.item.type === 'clip';

export function VideoTrack({
  model,
  pxPerFrame,
  selectedClipId,
  selectedIds,
  aiMarks,
  onPick,
  onSelect,
  pictureFor,
  edits,
  onOpenInspector,
}: VideoTrackProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const track = useRef<HTMLDivElement>(null);
  const blocks = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const dragged = useRef<string | null>(null);
  const [order, setOrder] = useState<readonly string[] | null>(null);
  const [trim, setTrim] = useState<Trim | null>(null);

  const docOrder = model.positions.map((position) => position.item.id);
  // Types too: a filled gap is a clip under the same id.
  const docKey = model.positions.map((position) => `${position.item.type}:${position.item.id}`).join(',');
  // A new revision is the truth: drop any preview of a drag.
  useEffect(() => setOrder(null), [docKey]);
  // A gap fixed from its popover: focus goes to what took its place once the new revision is on the bed.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    blocks.current.get(id)?.focus();
  }, [docKey]);
  const byId = new Map(model.positions.map((position) => [position.item.id as string, position]));
  const shown = (order ?? docOrder).map((id) => byId.get(id)).filter((p): p is PositionView => !!p);
  const shownKey = shown.map((p) => p.item.id).join(',');
  useFlip(track, shownKey, pxPerFrame, dragged);
  // The others moved to make room: the dragged clip stays under the pointer.
  useLayoutEffect(() => {
    const state = drag.current;
    const el = state?.moving ? blocks.current.get(state.clipId) : undefined;
    if (state && el) el.style.transform = `translateX(${state.x - state.grab - el.offsetLeft}px)`;
  }, [shownKey]);

  const clips = model.clips;
  const items = model.positions;
  /** Focus a clip (and select it) or a gap (selection stays: a gap isn't something the inspector shows). */
  const focusItem = (id: TimelineItemId) => {
    if (clips.some((clip) => clip.item.id === id)) onSelect(id);
    requestAnimationFrame(() => blocks.current.get(id)?.focus());
  };
  const neighbour = (position: PositionView, step: -1 | 1) => items[items.indexOf(position) + step] ?? null;

  /** Arrows, Home and End on a clip or a gap: the next block, the first or the last. */
  const navigate = (position: PositionView, event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && !event.shiftKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const next = neighbour(position, key === 'ArrowLeft' ? -1 : 1);
      if (next) focusItem(next.item.id);
      return true;
    }
    if (key === 'Home' || key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      const next = key === 'Home' ? items[0] : items.at(-1);
      if (next) focusItem(next.item.id);
      return true;
    }
    return false;
  };

  const onKeyDown = (clip: ClipView, event: KeyboardEvent<HTMLDivElement>) => {
    const beat = model.beatFrames;
    const key = event.key;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && event.metaKey) {
      handled();
      const to = clip.index + (key === 'ArrowLeft' ? -1 : 1);
      if (to >= 0 && to < model.positions.length) void edits.move(clip.item.id, to);
      return;
    }
    // ⌘[ and ⌘] (Ctrl on other keyboards) are the window's Back and Forward, never a trim.
    const bracket = (key === '[' || key === ']') && !event.metaKey && !event.ctrlKey;
    if (bracket || ((key === 'ArrowLeft' || key === 'ArrowRight') && event.altKey)) {
      handled();
      const longer = key === ']' || key === 'ArrowRight';
      void edits.trim(clip.item.id, 'end', longer ? beat : -beat);
      return;
    }
    if (navigate(clip, event)) return;
    if (key === 'Enter') {
      handled();
      onOpenInspector();
      return;
    }
    if (key === 'Escape') {
      handled();
      onSelect(null);
    }
  };

  const local = (clientX: number) => clientX - (track.current?.getBoundingClientRect().left ?? 0);

  const onBodyPointerDown = (clip: ClipView, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (onPick) onPick(clip.item.id, event.shiftKey, event.metaKey || event.ctrlKey);
    else onSelect(clip.item.id);
    if (event.shiftKey || event.metaKey || event.ctrlKey || edits.pending) return;
    const el = blocks.current.get(clip.item.id);
    if (!el) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      clipId: clip.item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      grab: local(event.clientX) - el.offsetLeft,
      moving: false,
      target: clip.index,
      x: local(event.clientX),
    };
  };

  const targetIndex = (state: Drag, x: number) => {
    const el = blocks.current.get(state.clipId);
    const width = el?.offsetWidth ?? 0;
    const centre = x - state.grab + width / 2;
    let left = 0;
    let index = 0;
    for (const position of model.positions) {
      if (position.item.id === state.clipId) continue;
      const w = (position.end - position.start) * pxPerFrame;
      if (left + w / 2 < centre) index += 1;
      left += w;
    }
    return index;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.moving) {
      if (Math.abs(event.clientX - state.startX) < DRAG_PX || model.positions.length < 2) return;
      state.moving = true;
      dragged.current = state.clipId;
      blocks.current.get(state.clipId)?.setAttribute('data-dragging', '');
    }
    const x = local(event.clientX);
    state.x = x;
    const target = targetIndex(state, x);
    if (target !== state.target) {
      state.target = target;
      const rest = docOrder.filter((id) => id !== state.clipId);
      rest.splice(target, 0, state.clipId);
      setOrder(rest);
    }
    const el = blocks.current.get(state.clipId);
    if (el) el.style.transform = `translateX(${x - state.grab - el.offsetLeft}px)`;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state || !state.moving) return;
    const el = blocks.current.get(state.clipId);
    if (el) {
      el.removeAttribute('data-dragging');
      settle(el, local(event.clientX) - state.grab - el.offsetLeft);
    }
    dragged.current = null;
    const from = model.positions.findIndex((position) => position.item.id === state.clipId);
    if (state.target === from) {
      setOrder(null);
      return;
    }
    void edits.move(state.clipId, state.target).then((result) => {
      if (!result.ok) setOrder(null);
    });
  };

  const onEdgePointerDown = (clip: ClipView, edge: 'start' | 'end', event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect(clip.item.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    const position = clip.index;
    const before = model.positions[position - 1];
    const after = model.positions[position + 1];
    const cut = edge === 'end' ? clip.end : clip.start;
    const min = edge === 'end' ? clip.start + MIN_CLIP_FRAMES : (before?.start ?? 0) + MIN_CLIP_FRAMES;
    const max =
      edge === 'end'
        ? after
          ? after.end - MIN_CLIP_FRAMES
          : Number.POSITIVE_INFINITY
        : clip.end - MIN_CLIP_FRAMES;
    setTrim({ clip, edge, startX: event.clientX, min, max, cut });
  };

  const onTrimMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!trim) return;
    const origin = trim.edge === 'end' ? trim.clip.end : trim.clip.start;
    const raw = origin + (event.clientX - trim.startX) / pxPerFrame;
    const snapped = snapToBeat(model, Math.round(raw), SNAP_PX / pxPerFrame);
    const cut = Math.min(trim.max, Math.max(trim.min, snapped));
    if (cut !== trim.cut) setTrim({ ...trim, cut });
  };

  const onTrimUp = () => {
    if (!trim) return;
    setTrim(null);
    const by = trim.edge === 'end' ? trim.cut - trim.clip.end : trim.clip.start - trim.cut;
    if (by !== 0) void edits.trim(trim.clip.item.id, trim.edge, by);
  };

  const tabStopId = selectedClipId ?? items[0]?.item.id ?? null;
  const trimLength = trim ? (trim.edge === 'end' ? trim.cut - trim.clip.start : trim.clip.end - trim.cut) : 0;

  return (
    <div
      ref={track}
      role="listbox"
      aria-label={t`Clips`}
      aria-orientation="horizontal"
      data-slot="video-track"
      className="relative flex h-16 gap-px"
      onPointerMove={(event) => (trim ? onTrimMove(event) : onPointerMove(event))}
      onPointerUp={(event) => (trim ? onTrimUp() : onPointerUp(event))}
      onPointerCancel={() => {
        drag.current = null;
        dragged.current = null;
        setTrim(null);
        setOrder(null);
      }}
    >
      {shown.map((position) => {
        const width = Math.max(1, (position.end - position.start) * pxPerFrame - 1);
        if (position.item.type === 'program')
          return (
            <ProgramBlock key={position.item.id} position={position} width={width} onOpen={onOpenInspector} />
          );
        if (!isClip(position))
          return (
            <GapBlock
              key={position.item.id}
              ref={(el) => {
                if (el) blocks.current.set(position.item.id, el);
                else blocks.current.delete(position.item.id);
              }}
              position={position}
              width={width}
              tabStop={position.item.id === tabStopId}
              onNavigate={(event) => void navigate(position, event)}
              onSettled={(outcome) => {
                // A filled gap is a clip with the same id; a dropped one leaves its neighbour in its place.
                const at = items.indexOf(position);
                const near = outcome === 'dropped' ? (items[at + 1] ?? items[at - 1]) : position;
                if (near && outcome !== 'asked') pendingFocus.current = near.item.id;
              }}
            />
          );
        return (
          <ClipBlock
            key={position.item.id}
            ref={(el) => {
              if (el) blocks.current.set(position.item.id, el);
              else blocks.current.delete(position.item.id);
            }}
            aiMark={aiMarks?.get(position.item.id)}
            view={position}
            width={width}
            picture={pictureFor(position)}
            selected={
              selectedIds ? selectedIds.includes(position.item.id) : position.item.id === selectedClipId
            }
            tabStop={position.item.id === tabStopId}
            dragging={dragged.current === position.item.id}
            edges={{ start: position.index > 0, end: true }}
            onBodyPointerDown={(event) => onBodyPointerDown(position, event)}
            onEdgePointerDown={(edge, event) => onEdgePointerDown(position, edge, event)}
            onKeyDown={(event) => onKeyDown(position, event)}
            onFocus={() => {
              if (!onPick && position.item.id !== selectedClipId) onSelect(position.item.id);
            }}
          />
        );
      })}
      {trim ? (
        <div
          aria-hidden
          data-slot="trim-ghost"
          className="pointer-events-none absolute inset-y-[-6px] z-30 w-0.5 rounded-pill bg-primary-strong"
          style={{ transform: `translateX(${trim.cut * pxPerFrame - 1}px)` }}
        >
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded-sm bg-overlay px-1.5 py-0.5 text-2xs whitespace-nowrap text-ink tabular-nums shadow-sm">
            {time.length(trimLength, model.rate)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
