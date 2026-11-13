// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: timeline bed · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * the sunken bed under the viewer: the ruler, the clips (V1), the beats (rose ticks below them), the Pacing
 *   tab's bands when it is open (P3-V12), the words on screen (T1), and the marigold playhead over all of them; a
 *   gutter names each row with an icon; scrolls sideways when zoomed in, the playhead stays put on screen as you
 *   zoom; under it the Pacing tab's row; a cleanup plan's removed spans hatched over the clips (P3-V9)
 * states: default · range (a marigold wash over the stretch, its length in words) · empty: the page's
 *   TimelineEmpty instead · loading: the page's bones · each row carries its own control states
 * motion: none of its own (the playhead's transform, the clips' FLIP) · pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { TimelineItemId } from '@taalcut/core';
import { CONCEPT_ICONS, renderIcon, useTimecode } from '@taalcut/ui';
import { useLayoutEffect, useRef, useState, type RefObject, type WheelEvent } from 'react';
import { BeatLane } from './beat-lane';
import { CaptionsLane } from './captions-lane';
import { CleanupBedMarks } from './cleanup/cleanup-marks';
import { CommentPins } from './comments/comment-pins';
import { GraphicsGutter, GraphicsLane } from './graphics-lane';
import {
  EditorPacing,
  EditorPacingBar,
  EditorPacingGutter,
  EditorPacingProvider,
} from './energy/editor-pacing';
import { beatsBetween, type ClipView, type TimelineModel } from './model';
import type { Playhead } from './playhead';
import { PlayheadLine } from './playhead-line';
import { Ruler } from './ruler';
import { SoundLane } from './sound-lane';
import { TransitionMarks } from './transition-marks';
import type { EditorSelection } from './selection';
import { TextTrack } from './text-track';
import type { Edits } from './use-edits';
import type { AiEditMark } from './ai-edit-marks';
import { VideoTrack } from './video-track';

/** Room after the last clip, so its end can be grabbed and the playhead can sit past it. */
const TAIL_PX = 48;
/** The narrowest a frame gets, so a long film still shows each clip. */
const MIN_PX_PER_FRAME = 0.2;

export interface TimelineBedProps {
  model: TimelineModel;
  /** 1 fits the whole film in view; the transport's zoom multiplies it. */
  zoom: number;
  playhead: Playhead;
  selection: EditorSelection;
  selectedIds?: readonly TimelineItemId[];
  aiMarks?: ReadonlyMap<string, AiEditMark> | undefined;
  onPick?(id: TimelineItemId, shift: boolean, toggle: boolean): void;
  onSelect: (selection: EditorSelection) => void;
  pictureFor: (clip: ClipView) => string | null;
  edits: Edits;
  onOpenInspector: () => void;
  /** Pinch or ⌘-scroll on the bed: one zoom step in or out. */
  onZoomStep: (direction: -1 | 1) => void;
  scroller: RefObject<HTMLDivElement | null>;
  /** Told the pixels per frame each time the bed draws (the docked chat's part of the bed in view). */
  scale?: RefObject<number>;
}

export function TimelineBed({
  model,
  zoom,
  playhead,
  selection,
  selectedIds,
  aiMarks,
  onPick,
  onSelect,
  pictureFor,
  edits,
  onOpenInspector,
  onZoomStep,
  scroller,
  scale,
}: TimelineBedProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const [width, setWidth] = useState(0);
  const wheel = useRef(0);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => {
      if (box.clientWidth > 0) setWidth(box.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, [scroller]);

  const fit = width > 0 ? Math.max(MIN_PX_PER_FRAME, (width - TAIL_PX) / Math.max(1, model.total)) : 1;
  const pxPerFrame = fit * zoom;
  useLayoutEffect(() => {
    if (scale) scale.current = pxPerFrame;
  }, [scale, pxPerFrame]);

  // Zooming keeps the playhead where it was on screen (or the start, when it is out of view).
  const previous = useRef(pxPerFrame);
  useLayoutEffect(() => {
    const box = scroller.current;
    const before = previous.current;
    previous.current = pxPerFrame;
    if (!box || before === pxPerFrame) return;
    const frame = playhead.frame();
    const onScreen = frame * before - box.scrollLeft;
    const anchor = onScreen >= 0 && onScreen <= box.clientWidth ? onScreen : 0;
    box.scrollLeft = Math.max(0, frame * pxPerFrame - anchor);
  }, [pxPerFrame, playhead, scroller]);

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    // A pinch arrives as many small ctrl-wheel events: one step per 40 px of travel.
    wheel.current += event.deltaY;
    if (Math.abs(wheel.current) < 40) return;
    onZoomStep(wheel.current < 0 ? 1 : -1);
    wheel.current = 0;
  };

  const clipId: TimelineItemId | null = selection?.kind === 'clip' ? selection.clipId : null;
  const textId: TimelineItemId | null = selection?.kind === 'text' ? selection.itemId : null;
  const range = selection?.kind === 'range' ? selection : null;
  const content = model.total * pxPerFrame + TAIL_PX;

  return (
    <EditorPacingProvider>
      <div className="flex min-h-0 flex-col bg-sunken select-none">
        <div data-slot="timeline-bed" className="flex min-h-0">
          <div
            aria-hidden
            className="flex w-9 shrink-0 flex-col items-center border-r border-rule-subtle text-ink-3"
          >
            <div className="h-7 w-full border-b border-rule-subtle" />
            {/* The tracks' glyphs at the registry's small size: clips, pacing and text on screen. */}
            <div className="flex h-16 items-center" title={t`Clips`}>
              {renderIcon(CONCEPT_ICONS.clip, 'sm')}
            </div>
            <div className="h-3" />
            <EditorPacingGutter icon={renderIcon(CONCEPT_ICONS.pacing, 'sm')} />
            <div className="flex h-7 items-center" title={t`Text on screen`}>
              {renderIcon(CONCEPT_ICONS.text, 'sm')}
            </div>
            <GraphicsGutter />
          </div>
          <div
            ref={scroller}
            data-scroll-x=""
            className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2"
            onWheel={onWheel}
          >
            <div
              className="relative"
              style={{ width: content }}
              onPointerDown={(event) => {
                // A press on the bare bed lets go of the selection.
                if (event.target === event.currentTarget) onSelect(null);
              }}
            >
              <Ruler
                model={model}
                pxPerFrame={pxPerFrame}
                playhead={playhead}
                onRange={(start, end) => onSelect({ kind: 'range', start, end })}
              />
              <div className="relative pt-1">
                <VideoTrack
                  aiMarks={aiMarks}
                  model={model}
                  pxPerFrame={pxPerFrame}
                  selectedClipId={clipId}
                  {...(selectedIds ? { selectedIds } : {})}
                  {...(onPick ? { onPick } : {})}
                  onSelect={(id) => onSelect(id ? { kind: 'clip', clipId: id } : null)}
                  pictureFor={pictureFor}
                  edits={edits}
                  onOpenInspector={onOpenInspector}
                />
                <CleanupBedMarks pxPerFrame={pxPerFrame} />
                <TransitionMarks pxPerFrame={pxPerFrame} />
              </div>
              <BeatLane model={model} pxPerFrame={pxPerFrame} />
              <SoundLane
                pxPerFrame={pxPerFrame}
                selectedClipId={clipId}
                {...(selectedIds ? { selectedIds } : {})}
                {...(onPick ? { onPick } : {})}
                onSelectClip={(id) => onSelect({ kind: 'clip', clipId: id })}
              />
              <EditorPacing pxPerFrame={pxPerFrame} />
              <TextTrack
                model={model}
                pxPerFrame={pxPerFrame}
                selectedId={textId}
                onSelect={(id) => onSelect(id ? { kind: 'text', itemId: id } : null)}
                edits={edits}
              />
              <CaptionsLane pxPerFrame={pxPerFrame} />
              <GraphicsLane pxPerFrame={pxPerFrame} selection={selection} onSelect={onSelect} />
              {range ? (
                <div
                  data-slot="timeline-range"
                  className="pointer-events-none absolute top-0 bottom-0 z-10 border-x border-primary-strong bg-primary-strong/15"
                  style={{ left: range.start * pxPerFrame, width: (range.end - range.start) * pxPerFrame }}
                >
                  <span className="absolute top-1 left-1 rounded-sm bg-overlay px-1.5 py-0.5 text-2xs leading-none whitespace-nowrap text-ink tabular-nums shadow-sm">
                    {time.clock(range.start, model.rate)}–{time.clock(range.end, model.rate)} ·{' '}
                    <Plural
                      value={beatsBetween(model, range.start, range.end)}
                      one="# beat"
                      other="# beats"
                    />
                  </span>
                </div>
              ) : null}
              {/* EDT1-CMT: a pin for each comment still waiting, on the ruler's lower edge. */}
              <CommentPins pxPerFrame={pxPerFrame} />
              <PlayheadLine model={model} pxPerFrame={pxPerFrame} playhead={playhead} scroller={scroller} />
            </div>
          </div>
        </div>
        <EditorPacingBar />
      </div>
    </EditorPacingProvider>
  );
}
