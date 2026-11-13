// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '../use-arrival';
import { DEFAULT_LENGTH, pickShort, runTimes, shortSeconds } from './trip';

/**
 * Making a short, as one run: the server's HTML (and reduced motion) is the made short; scrolled to, Create short
 * plays once (the AI marks the hook, the context and the payoff along the long video, they gather into the short, the
 * second check passes); and Create short plays it again for the length the visitor chose. `ms` is the run's clock.
 */
export function useShortRun(autoplay = true) {
  const reduce = useReducedMotionPref();
  const [box, phase] = useArrival<HTMLDivElement>(0.35, 0.6);
  const [target, setTarget] = useState(DEFAULT_LENGTH);
  const picks = useMemo(() => pickShort(target), [target]);
  const times = useMemo(() => runTimes(picks.length), [picks.length]);
  const [ms, setMs] = useState(() => runTimes(pickShort(DEFAULT_LENGTH).length).end);
  /** How many runs have finished in this browser: the preview starts playing after one. */
  const [made, setMade] = useState(0);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  const create = useCallback(
    (seconds: number) => {
      stop();
      setTarget(seconds);
      const t = runTimes(pickShort(seconds).length);
      if (reduce) {
        setMs(t.end);
        return;
      }
      setMs(-1);
      const steps = [...t.marks, ...t.gathers, t.checking, t.passed, t.end];
      timers.current = steps.map((at) =>
        window.setTimeout(() => {
          setMs(at);
          if (at === t.end) setMade((n) => n + 1);
        }, at),
      );
    },
    [reduce, stop],
  );

  // A length the visitor chose before the arrival could run is theirs: the arrival never makes it over at 60 sec.
  const chosen = useRef(false);
  const choose = useCallback(
    (seconds: number) => {
      chosen.current = true;
      create(seconds);
    },
    [create],
  );

  useEffect(() => {
    if (!autoplay || chosen.current) return;
    if (phase === 'waiting') setMs(-1);
    else if (phase === 'play') create(DEFAULT_LENGTH);
  }, [autoplay, phase, create]);
  useEffect(() => stop, [stop]);

  const marked = times.marks.filter((at) => ms >= at).length;
  const gathered = times.gathers.filter((at) => ms >= at).length;
  const check: 'waiting' | 'checking' | 'passed' = ms >= times.passed ? 'passed' : ms >= times.checking ? 'checking' : 'waiting';
  return {
    box,
    phase,
    target,
    picks,
    seconds: shortSeconds(picks),
    marked,
    gathered,
    check,
    /** Whether a run is under way (the parts still to come wait as ghosts). */
    running: ms < times.end,
    made,
    create: choose,
  };
}

export type ShortRun = ReturnType<typeof useShortRun>;

/** The short's player: its time in seconds, Play and Pause, a seek, and the end where it stops. */
export function usePreview(duration: number) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const from = useRef({ wall: 0, at: 0 });
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (now: number) => {
      const next = from.current.at + (now - from.current.wall) / 1000;
      if (next >= duration) {
        setAt(duration);
        setPlaying(false);
        return;
      }
      setAt(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  const play = useCallback(
    (start: number) => {
      const begin = start >= duration - 0.05 ? 0 : start;
      from.current = { wall: performance.now(), at: begin };
      setAt(begin);
      setPlaying(true);
    },
    [duration],
  );
  const toggle = () => (playing ? setPlaying(false) : play(at));
  const seek = (t: number) => {
    if (playing) play(t);
    else setAt(t);
  };
  const reset = useCallback(() => {
    setPlaying(false);
    setAt(0);
  }, []);
  return { at: Math.min(at, duration), playing, toggle, play, seek, reset };
}
