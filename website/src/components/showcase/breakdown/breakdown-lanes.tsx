// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the breakdown's lanes · mode: Operate · system: WEB2 Remix Vernacular (rose is rhythm: beats and slot
 *   boundaries; footage on the viewer grey; marigold the playhead and the live choice)
 * the reel on one time axis: the seconds, the music beats (each bar's first taller), a mark over each cut (the
 *   dashed warning circle over one Taalcut isn't sure of), the shots between the cuts (a label strip with the slot's
 *   number, and its name where it fits, over a filmstrip of its real frames), and the reel's own words on screen at
 *   their times, a row each where two overlap. While the reel beside it plays, a marigold playhead follows its clock
 *   (`time`). Each cut is a slider: hover or focus shows its
 *   time, ← → move it a frame, ⇧← ⇧→ a beat, Return says it looks right, Escape puts it back; a press chooses it
 *   (the parent's Frame earlier and Frame later move it, for touch), and a drag moves it from where it was, snapping
 *   to a beat it comes near (Option drags free). Each grip is 24 px wide, on alternate halves of the strip, and
 *   never reaches past halfway to the next grip on its half, so no two targets overlap. Below 36rem the lanes keep
 *   that spacing and scroll sideways inside the plate, and a line under them says so (WCAG 2.5.8)
 * states: cut default (a rose line through the shots) · hover (the grip and the time) · focus (base ring, the time) ·
 *   chosen (its grip stays shown) · active (dragging: the marigold line) · not sure (the dashed warning circle) ·
 *   moved (a teal line: yours) · disabled n/a · loading/error n/a (sample data) · success (the parent's "every cut
 *   checked")
 * motion: the page's one arrival: once, when scrolled to, a marigold playhead reads the reel left to right and each
 *   beat and cut strikes as it passes (transform only); reduced motion: nothing moves */

import { motion, type MotionValue, useMotionValue } from 'motion/react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '#lib/cn';
import { Filmstrip } from '../frame';
import { filmstripCount, framesOf } from '../frames';
import { SHOWCASE_ICONS } from '../icons';
import { formatTime, pct } from '../timecode';
import { GRIP_PX, LANES_MIN_PX, cutToBeat, gripReach, nudgeCut, snapCut } from './cuts';
import { anchor, Label, LivePlayhead, strike, SWEEP } from './lane-parts';
import { textRows, type SampleBreakdown } from './sample';

/** How far a press must travel before it drags: a tap only chooses the cut, however the finger wobbles. */
const DRAG_SLOP = 4;

/** A drag in progress: the cut, and where the pointer and the cut were when it was pressed. */
interface Drag {
  readonly index: number;
  readonly x: number;
  readonly from: number;
  moved: boolean;
}

export interface BreakdownLanesProps {
  readonly sample: SampleBreakdown;
  readonly times: readonly number[];
  readonly original: readonly number[];
  /** Cuts still to check (Taalcut isn't sure of them, and nobody has moved or approved them). */
  readonly open: ReadonlySet<number>;
  readonly active: number | null;
  readonly onActive: (index: number | null) => void;
  /** The cut last focused or pressed: the one the parent's frame buttons move. */
  readonly selected?: number | null;
  readonly onSelect?: (index: number) => void;
  readonly onMove: (index: number, time: number) => void;
  readonly onReset: (index: number) => void;
  readonly onLooksRight: (index: number) => void;
  readonly play: boolean;
  /** The features index: the beats, the cuts and the shots only. */
  readonly compact?: boolean;
  /** The reel's clock while it plays beside the lanes: a playhead follows it. */
  readonly time?: MotionValue<number>;
}

export function BreakdownLanes(props: BreakdownLanesProps) {
  const {
    sample,
    times,
    original,
    open,
    active,
    onActive,
    selected = null,
    onSelect,
    onMove,
    onReset,
    onLooksRight,
    play,
    compact = false,
    time,
  } = props;
  const still = useMotionValue(0);
  const rows = textRows(sample.texts);
  const textHeight = (Math.max(0, ...rows) + 1) * 30;
  const { duration, beats } = sample;
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const edges = [0, ...times, duration];
  const rulerMarks = Array.from({ length: Math.floor(duration / 2) + 1 }, (_, i) => i * 2);
  // The arrival's playhead reads the reel once and goes: it mounts when that run starts (derived during render, so it
  // mounts at its start), and the server HTML, where nothing has run, holds none at opacity 0.
  const [swept, setSwept] = useState(false);
  if (play && !swept) setSwept(true);

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    const direction =
      key === 'ArrowRight' || key === 'ArrowUp' ? 1 : key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0;
    if (direction !== 0) {
      event.preventDefault();
      onMove(
        index,
        event.shiftKey
          ? cutToBeat(times, index, direction, beats, duration)
          : nudgeCut(times, index, direction, duration),
      );
    } else if (key === 'Escape' && times[index] !== original[index]) {
      event.preventDefault();
      onReset(index);
    } else if (key === 'Enter') {
      event.preventDefault();
      onLooksRight(index);
    }
  };
  /** A drag moves the cut by how far the pointer went, from where the cut was, never to wherever it was pressed. */
  const dragTo = (event: PointerEvent<HTMLDivElement>, index: number) => {
    const now = drag.current;
    const box = track.current?.getBoundingClientRect();
    if (!now || now.index !== index || !box) return;
    const dx = event.clientX - now.x;
    if (!now.moved && Math.abs(dx) < DRAG_SLOP) return;
    now.moved = true;
    onMove(
      index,
      snapCut(
        times,
        index,
        now.from + (dx / Math.max(1, box.width)) * duration,
        event.altKey ? [] : beats,
        duration,
      ),
    );
  };
  const letGo = () => {
    drag.current = null;
  };

  const row = compact ? 'h-12' : 'h-16 sm:h-20';
  return (
    <div className={cn('grid grid-cols-1 gap-x-4', !compact && 'sm:grid-cols-[7.5rem_minmax(0,1fr)]')}>
      {compact ? null : (
        <div aria-hidden className="hidden flex-col sm:flex">
          <span className="h-5" />
          <Label icon={SHOWCASE_ICONS.beat} tone="text-rose-strong" className="h-4">
            Music beats
          </Label>
          <span className="h-4" />
          <Label icon={SHOWCASE_ICONS.clip} className={row}>
            Shots and cuts
          </Label>
          <Label icon={SHOWCASE_ICONS.text} className="mt-2 h-7">
            Text on screen
          </Label>
        </div>
      )}
      <div className="@container flex min-w-0 flex-col gap-1">
        {/* The lanes scroll as one, the labels and the rest of the plate stay put; pb-2 keeps a lower grip's ring. */}
        <div
          role="group"
          aria-label="The reel on one time axis"
          className="overflow-x-auto overscroll-x-contain pb-2"
        >
          <div ref={track} className="relative" style={{ minWidth: LANES_MIN_PX }}>
            <div aria-hidden className="relative h-5">
              {rulerMarks.map((second, i) => (
                <span
                  key={second}
                  className={cn(
                    'absolute top-0 tc-mono type-caption text-ink-3',
                    i === 0 ? '' : second >= duration - 0.5 ? '-translate-x-full' : '-translate-x-1/2',
                    i % 2 === 1 && 'max-sm:hidden',
                  )}
                  style={{ left: pct(second, duration) }}
                >
                  {formatTime(second, false)}
                </span>
              ))}
            </div>
            <div aria-hidden className="relative h-4">
              {beats.map((beat, i) => (
                <motion.span
                  key={beat}
                  {...strike(play, beat, duration)}
                  className={cn(
                    'absolute bottom-0 w-px origin-bottom rounded-pill',
                    i % 4 === 0 ? 'h-3 bg-beat-strong' : 'h-1.5 bg-beat',
                  )}
                  style={{ left: pct(beat, duration) }}
                />
              ))}
            </div>
            <div aria-hidden className="relative h-4">
              {times.map((time, i) =>
                open.has(i) ? (
                  <span
                    key={i}
                    className="absolute top-0.5 size-3 -translate-x-1/2 rounded-pill border-2 border-dashed border-warning-strong"
                    style={{ left: pct(time, duration) }}
                  />
                ) : (
                  <motion.span
                    key={i}
                    {...strike(play, time, duration)}
                    className={cn(
                      'absolute bottom-0.5 h-2 w-0.5 -translate-x-1/2 origin-bottom rounded-pill',
                      time !== original[i] ? 'bg-you-strong' : 'bg-beat-strong',
                    )}
                    style={{ left: pct(time, duration) }}
                  />
                ),
              )}
            </div>
            <ol className="sr-only" aria-label="Shots">
              {sample.shots.map((shot, i) => (
                <li key={`${shot.clipId}-${i}`}>
                  Slot {i + 1}, {shot.word}, from {formatTime(edges[i] ?? 0)} to{' '}
                  {formatTime(edges[i + 1] ?? duration)}
                </li>
              ))}
            </ol>
            <div className={cn('relative', row)}>
              {sample.shots.map((shot, i) => {
                const start = edges[i] ?? 0;
                const end = edges[i + 1] ?? duration;
                return (
                  <span
                    key={`${shot.clipId}-${i}`}
                    aria-hidden
                    data-shot={i}
                    className="absolute inset-y-0 px-px"
                    style={{ left: pct(start, duration), width: pct(end - start, duration) }}
                  >
                    <span className="@container flex size-full flex-col overflow-hidden rounded-clip border border-rule-subtle bg-raised">
                      <span className="flex h-4 shrink-0 items-center gap-1 px-1 type-caption leading-none whitespace-nowrap text-ink-2">
                        <span className="hidden tabular-nums @[1rem]:inline">{i + 1}</span>
                        <span className="hidden min-w-0 truncate text-ink-3 @[6rem]:inline">{shot.word}</span>
                      </span>
                      <Filmstrip
                        sprites={framesOf(shot.clipId)}
                        count={filmstripCount((end - start) / duration, compact ? 60 : 32)}
                        className="flex-1"
                      />
                    </span>
                  </span>
                );
              })}
              {times.map((time, i) => {
                const moved = time !== original[i];
                const held = active === i && drag.current?.index === i && drag.current.moved;
                return (
                  <span
                    key={`line-${sample.cuts[i]?.id ?? i}`}
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-pill',
                      held ? 'bg-playhead-strong' : moved ? 'bg-you-strong' : 'bg-beat-strong',
                    )}
                    style={{ left: pct(time, duration) }}
                  />
                );
              })}
              {times.map((time, i) => {
                const moved = time !== original[i];
                const doubt = sample.cuts[i]?.doubt;
                const upper = i % 2 === 0;
                // Half a grip each way, or half the way to the next grip on this half, whichever is less (WCAG 2.5.8).
                const [back, ahead] = gripReach(times, i, duration);
                const before = `min(${GRIP_PX / 2}px, ${pct(back, duration)})`;
                const after = `min(${GRIP_PX / 2}px, ${pct(ahead, duration)})`;
                return (
                  <div key={sample.cuts[i]?.id ?? i} className="pointer-events-none absolute inset-0 z-[1]">
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={`Cut ${i + 1}`}
                      aria-orientation="horizontal"
                      aria-valuemin={0}
                      aria-valuemax={Math.round(duration * 100) / 100}
                      aria-valuenow={time}
                      aria-valuetext={`${formatTime(time)}${open.has(i) ? ', not sure' : moved ? ', moved by you' : ''}`}
                      data-cut={i}
                      data-moved={moved || undefined}
                      data-doubt={doubt}
                      onKeyDown={onKeyDown(i)}
                      onFocus={() => {
                        onActive(i);
                        onSelect?.(i);
                      }}
                      onBlur={() => onActive(null)}
                      onPointerEnter={() => onActive(i)}
                      onPointerLeave={() => drag.current === null && onActive(null)}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        drag.current = { index: i, x: event.clientX, from: time, moved: false };
                        event.currentTarget.focus({ preventScroll: true });
                        onSelect?.(i);
                      }}
                      onPointerMove={(event) => dragTo(event, i)}
                      onPointerUp={letGo}
                      onPointerCancel={letGo}
                      className={cn(
                        'peer pointer-events-auto absolute cursor-ew-resize touch-none rounded-sm',
                        upper ? '-top-1 bottom-1/2' : 'top-1/2 -bottom-1',
                      )}
                      style={{
                        left: `calc(${pct(time, duration)} - ${before})`,
                        width: `calc(${before} + ${after})`,
                      }}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        'absolute h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-pill transition-opacity duration-(--dur-micro) ease-(--ease-out)',
                        upper ? 'top-1/4' : 'top-3/4',
                        selected === i
                          ? 'opacity-100'
                          : 'opacity-0 peer-hover:opacity-100 peer-focus-visible:opacity-100',
                        moved ? 'bg-you-strong' : 'bg-beat-strong',
                      )}
                      style={{ left: pct(time, duration) }}
                    />
                  </div>
                );
              })}
              {active !== null && times[active] !== undefined ? (
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute bottom-full z-[2] mb-6 rounded-md border border-tooltip-rule bg-tooltip px-2 py-1 tc-mono type-caption whitespace-nowrap text-on-tooltip',
                    anchor(times[active], duration),
                  )}
                  style={{ left: pct(times[active], duration) }}
                >
                  {formatTime(times[active])}
                </span>
              ) : null}
            </div>
            {compact ? null : (
              <ul
                aria-label="Text on screen"
                className="relative m-0 mt-2 list-none p-0"
                style={{ height: textHeight }}
              >
                {sample.texts.map((span, i) => (
                  <li
                    key={span.text}
                    className="absolute h-7 px-px"
                    style={{
                      left: pct(span.start, duration),
                      width: pct(span.end - span.start, duration),
                      top: (rows[i] ?? 0) * 30,
                    }}
                  >
                    <span className="flex h-full w-max min-w-full items-center gap-1.5 rounded-md border border-rule-subtle bg-sunken px-2 type-caption whitespace-nowrap text-ink">
                      <SHOWCASE_ICONS.text aria-hidden className="size-3 shrink-0 text-ink-3" />
                      <span>“{span.text}”</span>
                      <span className="sr-only">
                        , from {formatTime(span.start)} to {formatTime(span.end)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <LivePlayhead time={time ?? still} duration={duration} />
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              {swept ? (
                <motion.div
                  initial={{ opacity: 0, x: '0%' }}
                  animate={{ opacity: [0, 1, 1, 0], x: ['0%', '100%'] }}
                  transition={{
                    x: { delay: 0.15, duration: SWEEP, ease: 'linear' },
                    opacity: { delay: 0.15, duration: SWEEP, times: [0, 0.04, 0.94, 1] },
                  }}
                  className="absolute inset-0"
                >
                  <span className="absolute inset-y-0 left-0 w-0.5 rounded-pill bg-playhead" />
                </motion.div>
              ) : null}
            </div>
          </div>
        </div>
        <p className="m-0 type-caption text-ink-2 @min-[36rem]:hidden">
          Scroll the lanes sideways to reach every cut.
        </p>
      </div>
    </div>
  );
}
