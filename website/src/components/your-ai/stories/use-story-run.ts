// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* hook: a story's clock · mode: Persuade · system: WEB2 Remix Vernacular · states: finished (the start, the server
 *   HTML) · playing · resting on a segment · motion: one linear run of the clock, under five seconds; none under reduced
 *   motion (the callers never play then). */

import { animate, type AnimationPlaybackControls, type MotionValue, useMotionValue, useMotionValueEvent } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { restTime, runSeconds, segmentAt } from './story-model';

/**
 * A story's clock: `time` runs from 0 to `count` while it plays (segment k from k to k + 1), and `at` is the segment it
 * shows. It starts finished (time = count, every segment shown), which is the server HTML and the reduced-motion state.
 * `ran` turns true the first time it moves in the browser, so what appears from then on may pop in, and nothing in the
 * server HTML ever rests hidden.
 */
export interface StoryRun {
  readonly time: MotionValue<number>;
  readonly at: number;
  readonly playing: boolean;
  readonly ran: boolean;
  /** Play from the first segment to the last, once, under five seconds. */
  readonly play: () => void;
  /** Rest on segment k, every one before it shown. */
  readonly show: (k: number) => void;
  /** Rest on the finished story. */
  readonly finish: () => void;
}

export function useStoryRun(count: number): StoryRun {
  const time = useMotionValue(count);
  const [at, setAt] = useState(segmentAt(count, count));
  const [playing, setPlaying] = useState(false);
  const [ran, setRan] = useState(false);
  const controls = useRef<AnimationPlaybackControls | null>(null);

  useMotionValueEvent(time, 'change', (t) => setAt(segmentAt(t, count)));

  const stop = useCallback(() => {
    controls.current?.stop();
    controls.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    stop();
    setRan(true);
    time.set(0);
    setAt(0);
    setPlaying(true);
    controls.current = animate(time, count, {
      duration: runSeconds(count),
      ease: 'linear',
      onComplete: () => {
        controls.current = null;
        setPlaying(false);
      },
    });
  }, [count, stop, time]);

  const show = useCallback(
    (k: number) => {
      stop();
      setRan(true);
      time.set(restTime(k, count));
      setAt(segmentAt(restTime(k, count), count));
    },
    [count, stop, time],
  );

  const finish = useCallback(() => {
    stop();
    time.set(count);
    setAt(segmentAt(count, count));
  }, [count, stop, time]);

  useEffect(() => () => controls.current?.stop(), []);

  return { time, at, playing, ran, play, show, finish };
}
