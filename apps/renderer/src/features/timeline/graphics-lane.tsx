// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: graphics lane (EDT1-GFX) · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * the motion graphics on the bed under the words on screen, each a quiet pill at its time with its kind's glyph and
 *   its words (as written, never translated); HFW1-UI: a graphic the AI designed by its design's name, then its
 *   words, and when it plays for a screen reader; one appears once the video has a graphic, and goes when none is left
 * pointer: press to select (the inspector shows it); drag the body to move it, an edge to trim it (half a second to
 *   fifteen); one graphics.edit when you let go (one ⌘Z)
 * keyboard: one tab stop (a listbox): ← → move between graphics, ⌥← ⌥→ move the selected one by a beat, Return
 *   opens it in the inspector, Escape lets go
 * states: default · hover · focus (the base ring) · active (pressed) · selected (a marigold ring inside) ·
 *   proposed (a dashed outline and "Proposed": the chat made it and it isn't in the video yet) · dragging (the
 *   pill where it would land, its time beside it) · error: the toast that names the cause · empty: no lane
 * motion: none · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { TimelineItemId } from '@taalcut/core';
import { cn, CONCEPT_ICONS, renderIcon, UserContent, useTimecode } from '@taalcut/ui';
import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useEditorContext } from './editor-context';
import { dragged, graphicRows, graphicViewsOf, type GraphicView } from './graphics-lane-model';
import type { EditorSelection } from './selection';
import { TimelineTrimHandles } from './timeline-trim-handles';
import { useGraphicTimingDrag } from './use-graphic-timing-drag';

/** One row of the lane (h-7). */
const ROW_PX = 28;

/** The lane's glyph in the bed's gutter; nothing when the video has no graphics. */
export function GraphicsGutter() {
  const { t } = useLingui();
  const editor = useEditorContext();
  const timeline = editor?.timeline;
  const rows = useMemo(() => (timeline ? graphicRows(graphicViewsOf(timeline)) : 0), [timeline]);
  if (rows === 0) return null;
  return (
    <div className="flex items-start pt-1.5" style={{ height: rows * ROW_PX }} title={t`Graphics`}>
      {renderIcon(CONCEPT_ICONS.graphic, 'sm')}
    </div>
  );
}

export interface GraphicsLaneProps {
  readonly pxPerFrame: number;
  readonly selection: EditorSelection;
  readonly onSelect: (selection: EditorSelection) => void;
}

export function GraphicsLane({ pxPerFrame, selection, onSelect }: GraphicsLaneProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const editor = useEditorContext();
  const timing = useGraphicTimingDrag(pxPerFrame);
  const { drag } = timing;
  const items = useRef(new Map<string, HTMLDivElement>());
  const timeline = editor?.timeline;
  const views = useMemo(() => (timeline ? graphicViewsOf(timeline) : []), [timeline]);
  if (!editor || !timeline || views.length === 0) return null;
  const { model } = editor;
  const rate = model.rate;
  const selectedId =
    selection?.kind === 'item' && selection.itemKind === 'graphic'
      ? (selection.itemId as TimelineItemId)
      : null;
  const tabStop = selectedId ?? views[0]?.item.id ?? null;
  // Choosing a graphic is the editor's select(target, at) (ctx): it is selected, the playhead goes to its first frame
  // so the viewer plays it (a proposal too), and it comes into view. Pressing the selected one again leaves the
  // playhead where it is, so a drag doesn't jump; clearing is the bed's.
  const select = (id: TimelineItemId | null) => {
    if (!id) return onSelect(null);
    if (id === selectedId) return;
    const view = views.find((candidate) => candidate.item.id === id);
    editor.select(
      { kind: 'item', timelineId: timeline.id, itemId: id, itemKind: 'graphic' },
      view ? view.start / (rate.num / rate.den) : null,
    );
  };

  const focusItem = (id: TimelineItemId) => {
    select(id);
    requestAnimationFrame(() => items.current.get(id)?.focus());
  };

  const onKeyDown = (view: GraphicView, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (event.shiftKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      if (event.altKey) {
        timing.edit(view, dragged(view, 'move', step * model.beatFrames, model.total, rate));
        return;
      }
      const next = views[views.indexOf(view) + step];
      if (next) focusItem(next.item.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      select(view.item.id);
      editor.editText({ kind: 'item', timelineId: timeline.id, itemId: view.item.id, itemKind: 'graphic' });
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      timing.cancel();
      select(null);
    }
  };

  return (
    <div
      role="listbox"
      aria-label={t`Graphics`}
      aria-orientation="horizontal"
      data-slot="graphics-lane"
      className="relative"
      style={{ height: graphicRows(views) * ROW_PX }}
    >
      {views.map((view) => {
        const at = drag?.view.item.id === view.item.id && drag.moving ? drag.to : view;
        const left = at.start * pxPerFrame;
        const width = Math.max(22, (at.end - at.start) * pxPerFrame - 2);
        const selected = view.item.id === selectedId;
        const from = time.clock(view.start, rate);
        const to = time.clock(view.end, rate);
        const name = view.design ?? view.words ?? '';
        return (
          <div
            key={view.item.id}
            ref={(el) => {
              if (el) items.current.set(view.item.id, el);
              else items.current.delete(view.item.id);
            }}
            role="option"
            aria-selected={selected}
            tabIndex={view.item.id === tabStop ? 0 : -1}
            data-slot="timeline-graphic"
            data-graphic-id={view.item.id}
            data-item-id={view.item.id}
            data-proposed={view.proposed ? '' : undefined}
            className={cn(
              'group absolute flex h-5 cursor-grab touch-none items-center gap-1 overflow-hidden rounded-sm border border-rule bg-raised px-3 text-2xs font-medium whitespace-nowrap text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) select-none hover:bg-hover active:cursor-grabbing active:bg-pressed',
              view.proposed && 'border-dashed border-primary-strong',
              selected && 'border-primary-strong bg-selected text-ink hover:bg-selected',
            )}
            style={{ left, width, top: view.row * ROW_PX + 4 }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              select(view.item.id);
              timing.start(view, event);
            }}
            onPointerMove={timing.move}
            onPointerUp={timing.finish}
            onLostPointerCapture={timing.cancel}
            onPointerCancel={timing.cancel}
            onDoubleClick={() =>
              editor.editText({
                kind: 'item',
                timelineId: timeline.id,
                itemId: view.item.id,
                itemKind: 'graphic',
              })
            }
            onFocus={() => {
              if (!selected) select(view.item.id);
            }}
            onKeyDown={(event) => onKeyDown(view, event)}
          >
            <TimelineTrimHandles
              selected={selected}
              active={drag?.view.item.id === view.item.id && drag.mode !== 'move' ? drag.mode : null}
            />
            <span aria-hidden className="shrink-0 text-ink-3 [&_svg]:size-3">
              {renderIcon(CONCEPT_ICONS.graphic, 'sm')}
            </span>
            {view.proposed ? (
              <span className="shrink-0 font-semibold text-primary-strong">{t`Proposed`}</span>
            ) : null}
            {view.design !== null ? (
              // HFW1-UI: a designed graphic by its design's name, its words after it, and when it plays.
              <>
                <UserContent translate="no" className="shrink-0 truncate whitespace-nowrap text-ink">
                  {view.design}
                </UserContent>
                {view.words ? (
                  <UserContent translate="no" className="truncate font-normal whitespace-nowrap">
                    {view.words}
                  </UserContent>
                ) : null}
                <span className="sr-only">{t`, from ${from} to ${to}`}</span>
              </>
            ) : (
              <>
                <UserContent className="truncate whitespace-nowrap">{view.words ?? name}</UserContent>
                {/* Its kind for a screen reader, after the words it shows (the name starts with what you see). */}
                {view.words ? <span className="sr-only">{t`, ${name}`}</span> : null}
              </>
            )}
            {drag?.view.item.id === view.item.id && drag.moving ? (
              <span className="sr-only" role="status">
                {time.clock(drag.to.start, rate)}–{time.clock(drag.to.end, rate)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
