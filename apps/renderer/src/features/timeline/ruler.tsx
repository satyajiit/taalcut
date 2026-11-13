// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: timeline ruler · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * seconds in ink-3 tabular figures over hairline ticks; rhythm stays in the beat lane (rose), not here
 * states: default · hover (the pointer's time as a faint marigold hairline) · active (pressing seeks; dragging
 *   picks a range, on the beats: ⌥ lets it go between them) · focus: the playhead's handle is the ruler's one
 *   keyboard control (playhead-line.tsx) · disabled/loading/error/success: n/a (a picture of time, not a form)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useTimecode } from '@taalcut/ui';
import { useRef, useState, type PointerEvent } from 'react';
import { fpsOf, snapToBeat, type TimelineModel } from './model';
import type { Playhead } from './playhead';

/** Seconds between labels: the first step that leaves at least this many pixels. */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
const MIN_LABEL_PX = 56;
const DRAG_PX = 4;

export interface RulerProps {
  model: TimelineModel;
  pxPerFrame: number;
  playhead: Playhead;
  /** A stretch was dragged out (frames, end exclusive). */
  onRange: (start: number, end: number) => void;
}

export function Ruler({ model, pxPerFrame, playhead, onRange }: RulerProps) {
  const time = useTimecode();
  const fps = fpsOf(model.rate);
  const pxPerSecond = pxPerFrame * fps;
  const step = STEPS.find((seconds) => seconds * pxPerSecond >= MIN_LABEL_PX) ?? 120;
  const seconds = model.total / fps;
  const marks: number[] = [];
  for (let s = 0; s <= seconds + 1e-6; s += step) marks.push(Math.round(s * fps));
  const minor = step >= 1 ? step / (step >= 10 ? 5 : 2) : step;
  const minors: number[] = [];
  for (let s = 0; s <= seconds + 1e-6; s += minor) minors.push(Math.round(s * fps));

  const press = useRef<{ x: number; frame: number; range: boolean } | null>(null);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  // The pointer's time: a hairline moved straight in the DOM, so pointing never re-renders the ticks.
  const hoverLine = useRef<HTMLSpanElement>(null);
  const showHover = (frame: number | null) => {
    const line = hoverLine.current;
    if (!line) return;
    line.style.opacity = frame === null ? '0' : '0.4';
    if (frame !== null) line.style.transform = `translateX(${frame * pxPerFrame}px)`;
  };

  const frameAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(model.total, Math.max(0, Math.round((event.clientX - box.left) / pxPerFrame)));
  };
  // A stretch of time is counted in beats; ⌥ frees it from the grid.
  const snapped = (frame: number, free: boolean) => (free ? frame : snapToBeat(model, frame));

  return (
    <div
      data-slot="timeline-ruler"
      className="relative h-7 cursor-text touch-none border-b border-rule-subtle select-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { x: event.clientX, frame: frameAt(event), range: false };
      }}
      onPointerMove={(event) => {
        const frame = frameAt(event);
        const pressed = press.current;
        showHover(pressed?.range ? null : frame);
        if (!pressed) return;
        if (!pressed.range && Math.abs(event.clientX - pressed.x) < DRAG_PX) return;
        pressed.range = true;
        const a = snapped(pressed.frame, event.altKey);
        const b = snapped(frame, event.altKey);
        setDraft({ start: Math.min(a, b), end: Math.max(a, b) });
      }}
      onPointerUp={(event) => {
        const pressed = press.current;
        press.current = null;
        if (!pressed) return;
        if (pressed.range && draft && draft.end - draft.start >= 1) onRange(draft.start, draft.end);
        else if (!pressed.range) {
          if (playhead.playing()) playhead.pause();
          playhead.seek(frameAt(event));
        }
        setDraft(null);
      }}
      onPointerCancel={() => {
        press.current = null;
        setDraft(null);
      }}
      onPointerLeave={() => showHover(null)}
    >
      {minors.map((frame) => (
        <span
          key={`m${frame}`}
          aria-hidden
          className="absolute bottom-0 h-1.5 w-px bg-rule"
          style={{ transform: `translateX(${frame * pxPerFrame}px)` }}
        />
      ))}
      {marks.map((frame) => (
        <span
          key={frame}
          aria-hidden
          className="absolute top-0 flex h-full items-start"
          style={{ transform: `translateX(${frame * pxPerFrame}px)` }}
        >
          <span className="block h-full w-px bg-rule-strong" />
          {/* The start needs no label: the playhead's handle sits there. */}
          {frame > 0 ? (
            <span className="pt-1 pl-1 text-2xs leading-none text-ink-3 tabular-nums">
              {time.length(frame, model.rate)}
            </span>
          ) : null}
        </span>
      ))}
      <span
        ref={hoverLine}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 h-full w-px bg-primary-strong"
        style={{ opacity: 0 }}
      />
      {draft ? (
        <span
          aria-hidden
          data-slot="range-draft"
          className="pointer-events-none absolute top-0 h-full border-x border-primary-strong bg-primary-strong/15"
          style={{ left: draft.start * pxPerFrame, width: (draft.end - draft.start) * pxPerFrame }}
        />
      ) : null}
    </div>
  );
}
