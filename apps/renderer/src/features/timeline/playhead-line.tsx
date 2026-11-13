// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: playhead · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * the marigold line over every track (playhead-strong: a fill alone is too light on paper) with a handle on the
 * ruler · states: default · hover (the handle darkens) · focus (the base ring on the handle, instant) · active
 *   (grabbing: scrubs the viewer frame by frame) · disabled/loading/error/success: n/a
 * motion: moves by transform only, written from the playhead's subscription (no React render per frame)
 * pre-emit critique: P5 H5 E5 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { useTimecode } from '@taalcut/ui';
import { useRef, type KeyboardEvent, type RefObject } from 'react';
import { fpsOf, stepBeat, type TimelineModel } from './model';
import { usePlayheadFrame, type Playhead } from './playhead';
import { usePlayheadScrub } from './use-playhead-scrub';

export interface PlayheadLineProps {
  model: TimelineModel;
  pxPerFrame: number;
  playhead: Playhead;
  /** The bed's scroller: playback pages it along so the line stays in view. */
  scroller: RefObject<HTMLDivElement | null>;
}

export function PlayheadLine({ model, pxPerFrame, playhead, scroller }: PlayheadLineProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const line = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const scrub = usePlayheadScrub(playhead, scroller, pxPerFrame, model.total);

  usePlayheadFrame(playhead, (frame, source) => {
    const x = frame * pxPerFrame;
    if (line.current) line.current.style.transform = `translateX(${x}px)`;
    const knob = handle.current;
    if (knob) {
      knob.setAttribute('aria-valuenow', String(frame));
      knob.setAttribute('aria-valuetext', time.clock(frame, model.rate, { fraction: true }));
      knob.style.left = `${Math.max(-7, -x)}px`;
    }
    // Keyboard seeks and playback keep their handle visible; a captured drag is clamped to the viewport.
    const box = scroller.current;
    if (box && scrub.pointer.current === null) {
      const left = box.scrollLeft;
      if (x > left + box.clientWidth - 24) {
        box.scrollLeft = Math.max(0, source === 'player' ? x - 24 : x - box.clientWidth + 24);
      } else if (x < left) box.scrollLeft = Math.max(0, x - 24);
    }
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const frame = playhead.frame();
    const second = Math.round(fpsOf(model.rate));
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = event.shiftKey ? stepBeat(model, frame, -1) : frame - 1;
    else if (event.key === 'ArrowRight') next = event.shiftKey ? stepBeat(model, frame, 1) : frame + 1;
    else if (event.key === 'PageUp') next = frame - second;
    else if (event.key === 'PageDown') next = frame + second;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = model.total - 1;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    playhead.seek(next);
  };

  return (
    <div
      ref={line}
      data-slot="playhead"
      aria-hidden={false}
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-0 will-change-transform"
    >
      <div className="absolute top-0 bottom-0 -left-px w-0.5 rounded-pill bg-playhead-strong" />
      <div
        ref={handle}
        role="slider"
        tabIndex={0}
        aria-label={t`Playhead`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, model.total - 1)}
        aria-valuenow={playhead.frame()}
        aria-orientation="horizontal"
        data-slot="playhead-handle"
        className="pointer-events-auto absolute top-0 h-4 w-3.5 cursor-ew-resize touch-none rounded-sm border border-playhead-strong bg-playhead transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-playhead-strong active:bg-playhead-strong"
        style={{ left: Math.max(-7, -playhead.frame() * pxPerFrame) }}
        onKeyDown={onKeyDown}
        {...scrub.handlers}
      >
        <span
          aria-hidden
          className="absolute top-full left-1/2 h-1 w-px -translate-x-1/2 bg-playhead-strong"
        />
      </div>
    </div>
  );
}
