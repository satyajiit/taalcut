// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/**
 * The Trending sounds & hooks shelf's state, shared by the showcase and the features index's fragment: the tab, the
 * licence filter and the search; the saved sounds; the chosen sound and its playhead; which sounds Cut with AI has
 * run on; what is staged in Edits; and the one orchestrated arrival (play the chosen sound up to its hook, Cut with
 * AI, the vibe scores, then the stage card), which also replays on request. The server's HTML and reduced motion
 * show the finished shelf.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '../use-arrival';
import { FIRST_SAVED, type FeedTab, hooksOf, type LicenceFilter, SCORED, soundById, soundsIn } from './sounds';

/** The sound the shelf opens on, chosen and cut. */
export const FIRST_SOUND = 'boarding';

/** How much of the studio shows: all of it at rest; during the arrival, each part in turn. */
export interface Reveal {
  readonly hooks: boolean;
  readonly cut: boolean;
  readonly scores: number;
  readonly stage: boolean;
}
const FULL: Reveal = { hooks: true, cut: true, scores: SCORED.length, stage: true };
const START: Reveal = { hooks: false, cut: false, scores: 0, stage: false };

/** The playhead: still (null), or moving at `speed` times real time towards `to`. */
function usePlayhead() {
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);
  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setPlaying(false);
  }, []);
  const run = useCallback((from: number, to: number, speed = 1, onEnd?: () => void) => {
    cancelAnimationFrame(frame.current);
    const wall = performance.now();
    setAt(from);
    setPlaying(true);
    const tick = (now: number) => {
      const next = from + ((now - wall) / 1000) * speed;
      if (next >= to) {
        setAt(to);
        setPlaying(false);
        onEnd?.();
        return;
      }
      setAt(next);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return { at, setAt, playing, run, stop };
}

export type StageStatus = 'idle' | 'staging' | 'staged';

export function useShelf({ autoplay }: { readonly autoplay: boolean }) {
  const reduce = useReducedMotionPref();
  const [box, phase] = useArrival<HTMLDivElement>(0.35, 0.6);
  const [tab, setTabState] = useState<FeedTab>('Trending');
  const [licence, setLicenceState] = useState<LicenceFilter>('any');
  const [query, setQueryState] = useState('');
  const [fresh, setFresh] = useState(false);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set(FIRST_SAVED));
  const [chosen, setChosen] = useState(FIRST_SOUND);
  const [cutDone, setCutDone] = useState<ReadonlySet<string>>(() => new Set([FIRST_SOUND]));
  const [cutting, setCutting] = useState(false);
  const [reveal, setReveal] = useState<Reveal>(FULL);
  /** The arrival is waiting or playing (the page says so on the shelf: data-run). */
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Readonly<Record<string, StageStatus>>>({});
  const { at, setAt, playing, run, stop } = usePlayhead();
  const timers = useRef<number[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  /** The visitor took over: whatever the arrival was doing, show the finished studio. */
  const settle = useCallback(() => {
    clear();
    setCutting(false);
    setRunning(false);
    setReveal(FULL);
  }, [clear]);

  const sound = soundById(chosen);
  const sounds = soundsIn(tab, licence, query, saved);

  /** The arrival: play up to the hook, mark it, Cut with AI, score the clips, then the stage card. Under 4 s. */
  const replay = useCallback(() => {
    clear();
    const first = soundById(FIRST_SOUND);
    const hook = hooksOf(first)[0] ?? 3;
    setRunning(true);
    setTabState('Trending');
    setLicenceState('any');
    setQueryState('');
    setChosen(FIRST_SOUND);
    setStage({});
    setCutDone(new Set());
    setReveal(START);
    stop();
    setAt(0);
    later(250, () => run(0, hook, 3));
    later(1500, () => setReveal((r) => ({ ...r, hooks: true })));
    later(1850, () => setCutting(true));
    later(2350, () => {
      setCutting(false);
      setCutDone(new Set([FIRST_SOUND]));
      setReveal((r) => ({ ...r, cut: true }));
    });
    SCORED.forEach((_, i) => later(2750 + i * 180, () => setReveal((r) => ({ ...r, scores: i + 1 }))));
    later(3600, () => {
      setReveal(FULL);
      setRunning(false);
    });
  }, [clear, later, run, stop, setAt]);

  useEffect(() => {
    if (!autoplay) return;
    if (phase === 'waiting') {
      setRunning(true);
      setReveal(START);
      setCutDone(new Set());
      setAt(0);
    } else if (phase === 'play') replay();
  }, [autoplay, phase, replay, setAt]);
  useEffect(() => clear, [clear]);

  const filtered = (fn: () => void) => {
    settle();
    setFresh(true);
    fn();
  };

  return {
    box,
    phase,
    reduce,
    tab,
    licence,
    query,
    fresh,
    saved,
    sounds,
    sound,
    chosen,
    reveal,
    running,
    cutting,
    cut: cutDone.has(chosen),
    stage: stage[chosen] ?? 'idle',
    at,
    playing,
    replay,
    setTab: (next: FeedTab) => filtered(() => setTabState(next)),
    setLicence: (next: LicenceFilter) => filtered(() => setLicenceState(next)),
    setQuery: (next: string) => filtered(() => setQueryState(next)),
    clearFilters: () =>
      filtered(() => {
        setTabState('Trending');
        setLicenceState('any');
        setQueryState('');
      }),
    toggleSave: (id: string) =>
      setSaved((now) => {
        const next = new Set(now);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    /** Choose a sound and play it from the start (choosing the playing one pauses it). */
    choose: (id: string) => {
      settle();
      if (id === chosen && playing) {
        stop();
        return;
      }
      setChosen(id);
      run(0, soundById(id).durationSec, 1, () => setAt(null));
    },
    togglePlay: () => {
      settle();
      if (playing) {
        stop();
        return;
      }
      const from = at !== null && at < sound.durationSec - 0.05 ? at : 0;
      run(from, sound.durationSec, 1, () => setAt(null));
    },
    cutWithAi: () => {
      if (cutting) return;
      settle();
      const id = chosen;
      setCutting(true);
      setReveal({ ...FULL, scores: 0 });
      later(reduce ? 0 : 600, () => {
        setCutting(false);
        setCutDone((now) => new Set(now).add(id));
        if (reduce) {
          setReveal(FULL);
          return;
        }
        SCORED.forEach((_, i) => later(250 + i * 160, () => setReveal((r) => ({ ...r, scores: i + 1 }))));
      });
    },
    stageInEdits: () => {
      const id = chosen;
      settle();
      setStage((now) => ({ ...now, [id]: 'staging' }));
      later(reduce ? 0 : 900, () => setStage((now) => ({ ...now, [id]: 'staged' })));
    },
  };
}

export type Shelf = ReturnType<typeof useShelf>;
