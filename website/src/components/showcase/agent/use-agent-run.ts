// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useArrival } from '../use-arrival';
import { frameAt, frameTimes, RUN_END } from './run-script';

/** A pause before the run, so a replay reads as starting. */
const LEAD_IN = 200;

export type RunStatus = 'finished' | 'waiting' | 'playing';
/** The one approval: waiting for the visitor, reviewing (Your version on the reel), or exported. */
export type Review = 'waiting' | 'reviewing' | 'exported';
export type Think = 'low' | 'medium' | 'high';

/**
 * The agent showcase's state, shared by the reel beside the window and the chat in it. The run's clock: finished at
 * first (the server's HTML), waiting with its slots empty below the fold, played once when scrolled to (`autoplay`),
 * and again on Replay; then the visitor's undo, the review and how hard it thinks.
 */
export function useAgentRun(autoplay: boolean) {
  const [box, phase] = useArrival<HTMLDivElement>(0.35, 0.6);
  const [ms, setMs] = useState<number>(RUN_END);
  const [status, setStatus] = useState<RunStatus>('finished');
  const [undone, setUndone] = useState(0);
  const [review, setReview] = useState<Review>('waiting');
  const [think, setThink] = useState<Think>('medium');
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const play = useCallback(() => {
    stop();
    setMs(-1);
    setStatus('playing');
    timers.current = frameTimes().map((at) =>
      window.setTimeout(() => {
        setMs(at);
        if (at >= RUN_END) setStatus('finished');
      }, at + LEAD_IN),
    );
  }, [stop]);
  /** Replay: the run again from the start, the visitor's undo and review undone. */
  const replay = useCallback(() => {
    setUndone(0);
    setReview('waiting');
    play();
  }, [play]);

  useEffect(() => {
    if (!autoplay) return;
    if (phase === 'waiting') {
      setMs(-1);
      setStatus('waiting');
    } else if (phase === 'play') play();
  }, [autoplay, phase, play]);
  useEffect(() => stop, [stop]);

  return {
    box,
    ms,
    frame: frameAt(ms),
    status,
    replay,
    undone,
    setUndone,
    review,
    setReview,
    think,
    setThink,
  };
}

export type AgentRun = ReturnType<typeof useAgentRun>;
