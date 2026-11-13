// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The StructurePreview's one clock (U6, UX4 B18). It keeps time from one start timestamp, so a slow frame never
 * drifts the cuts. React hears from it only at the marks (a cut, a beat, a caption coming or going): a timeout
 * waits for the next mark, never a frame loop. What moves between marks (the playhead, the camera's push) runs as
 * a Web Animation on transform, which the compositor plays without a style recalculation per frame.
 *
 * It stops while the element is off screen (IntersectionObserver), while the window is hidden, when `playing`
 * goes false, and never runs under reduced motion. Stopped, it keeps its place unless `rewind` asks for the start
 * again (a list row's hover).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

export interface StructureClockOptions {
  /** Seconds before the clock goes round again. */
  readonly loop: number;
  readonly playing: boolean;
  /** Back to 0 when playing stops. */
  readonly rewind?: boolean;
  readonly reduced?: boolean;
  /** Seconds where what is drawn changes (cuts, beats, captions): the only moments React renders. */
  readonly marks?: readonly number[];
}

export interface StructureClock {
  /** Seconds into the structure, as of the last mark the clock crossed, or where it stopped. */
  readonly time: number;
  /** Moving now: playing, on screen, in a shown window, not reduced. */
  readonly running: boolean;
  /** Changes whenever the clock starts, stops or jumps, so the animations riding it line up again. */
  readonly epoch: number;
  /** Seconds into the loop at this instant, between marks too: what an animation starts from. */
  now(): number;
}

/** A clock that never moves, for a strip or frame drawn without one. */
export const STILL_CLOCK: StructureClock = { time: 0, running: false, epoch: 0, now: () => 0 };

/** A little slack for float sums: a mark at 0.5 is crossed at 0.4999999. */
const EPSILON = 1e-6;

function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries.at(-1);
      if (last) setVisible(last.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

function useWindowShown(): boolean {
  const [shown, setShown] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const update = () => setShown(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return shown;
}

/** The marks inside one loop, in order, once each; the loop's end is the last stop (back to 0). */
function stopsOf(marks: readonly number[], loop: number): readonly number[] {
  const inside = marks.filter((mark) => mark > EPSILON && mark < loop - EPSILON);
  return [...new Set(inside)].sort((a, b) => a - b);
}

export function useStructureClock(
  ref: RefObject<Element | null>,
  { loop, playing, rewind = false, reduced = false, marks = [] }: StructureClockOptions,
): StructureClock {
  const [time, setTime] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const onScreen = useOnScreen(ref);
  const shown = useWindowShown();
  const running = playing && !reduced && onScreen && shown && loop > 0;
  // Where the clock stood when it last started (`at`, a performance.now()) or stopped (`at` null).
  const anchor = useRef<{ at: number | null; offset: number }>({ at: null, offset: 0 });
  // Keyed on the marks' values, not the array's identity: a caller may build a new array each render.
  const marksKey = marks.join(',');
  const stops = useMemo(
    () => stopsOf(marksKey ? marksKey.split(',').map(Number) : [], loop),
    [marksKey, loop],
  );

  // Read through a ref so the animations always see the current loop without re-subscribing.
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const now = useRef(() => {
    const { at, offset } = anchor.current;
    const length = loopRef.current;
    if (length <= 0) return 0;
    if (at === null) return offset % length;
    return (offset + (performance.now() - at) / 1000) % length;
  }).current;

  useEffect(() => {
    if (!running) return;
    anchor.current = { at: performance.now(), offset: anchor.current.offset % loop };
    setEpoch((n) => n + 1);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const position = now();
      const next = stops.find((stop) => stop > position + EPSILON) ?? loop;
      timer = setTimeout(
        () => {
          // A timer can fire a hair early; the next schedule then waits the rest, so no mark is missed.
          setTime(now());
          schedule();
        },
        Math.max(0, (next - position) * 1000),
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
      const offset = now();
      anchor.current = { at: null, offset };
      setTime(offset);
      setEpoch((n) => n + 1);
    };
  }, [running, loop, stops, now]);

  useEffect(() => {
    // Already at the start (a row that never played): nothing to put back, and no render for it.
    if (playing || !rewind || anchor.current.offset === 0) return;
    anchor.current = { at: null, offset: 0 };
    setTime(0);
    setEpoch((n) => n + 1);
  }, [playing, rewind]);

  return { time: reduced ? 0 : time, running, epoch, now };
}

export interface ClockAnimationOptions {
  readonly clock: StructureClock;
  /** One run of the keyframes, in milliseconds. */
  readonly duration: number;
  /** Where the animation stands now, in milliseconds, read when the clock starts, stops or jumps. */
  readonly at: () => number;
  /** Infinity for the playhead, which goes round with the clock; 1 for a slot's camera move. */
  readonly iterations?: number;
}

/**
 * Plays `frames` on `ref`'s element as one Web Animation in step with the clock: placed at `at()` and played while
 * the clock runs, paused where it stands when it stops. Transform only, so the compositor runs it. `key` names the
 * frames, so a new slot or loop makes a new animation. Without the Web Animations API (jsdom) nothing runs, and
 * the inline style the component renders at each mark stands in.
 */
export function useClockAnimation(
  ref: RefObject<HTMLElement | null>,
  frames: Keyframe[] | null,
  key: string,
  { clock, duration, at, iterations = 1 }: ClockAnimationOptions,
): void {
  const latest = useRef({ frames, at });
  latest.current = { frames, at };
  const { running, epoch } = clock;
  useLayoutEffect(() => {
    const element = ref.current;
    const keyframes = latest.current.frames;
    if (!element || !keyframes || duration <= 0 || typeof element.animate !== 'function') return;
    const animation = element.animate(keyframes, { duration, iterations, easing: 'linear', fill: 'both' });
    animation.currentTime = Math.max(0, latest.current.at());
    if (running) animation.play();
    else animation.pause();
    return () => animation.cancel();
  }, [ref, key, duration, iterations, running, epoch]);
}
