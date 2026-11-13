// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '../use-arrival';
import {
  type Arrival,
  ASK_FOR,
  FIRST_SEND,
  firstArrivals,
  nextClips,
  RUN_END,
  SEND_EVERY,
  settledAt,
} from './ways';

/**
 * Phone over Wi-Fi as one run, shared by the window and the phone beside it. The server's HTML (and reduced motion) is
 * the finished run: the phone allowed, its first clips in the library at their stages. Scrolled to, it plays once: the
 * phone asks with its match code, Allow, the clips leave in turn and move through their stages. The visitor can
 * Deny, have the phone ask again and Allow it, and send more from either of the phone's two choices.
 */

export type Answer = 'asking' | 'allowed' | 'denied';

/** How often the run's clock moves while something is on its way, in ms. */
const TICK = 100;

export function useWifiRun() {
  const reduce = useReducedMotionPref();
  const [box, phase] = useArrival<HTMLDivElement>(0.35, 0.6);
  const [answer, setAnswer] = useState<Answer>('allowed');
  const [arrivals, setArrivals] = useState<readonly Arrival[]>(() => firstArrivals());
  const [clock, setClock] = useState(RUN_END);
  const [until, setUntil] = useState(RUN_END);
  /** The run allows the phone by itself (its first play), or waits for the visitor's Allow. */
  const auto = useRef(false);
  /** A run has started in this browser: what is still to come shows as ghosts. */
  const [ran, setRan] = useState(false);

  const run = useCallback(() => {
    auto.current = true;
    setRan(true);
    setAnswer('asking');
    setArrivals([]);
    setClock(0);
    setUntil(RUN_END);
  }, []);

  useEffect(() => {
    if (phase === 'waiting') {
      setRan(true);
      setAnswer('asking');
      setArrivals([]);
      setClock(0);
      setUntil(0);
    } else if (phase === 'play') run();
  }, [phase, run]);

  // The clock runs only while something is still on its way; under reduced motion it jumps to the end.
  const running = clock < until;
  useEffect(() => {
    if (!running) return;
    if (reduce) {
      setClock(until);
      return;
    }
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      setClock((c) => Math.min(until, c + (now - last)));
      last = now;
    }, TICK);
    return () => window.clearInterval(id);
  }, [running, until, reduce]);

  const allow = useCallback(
    (at: number) => {
      setAnswer('allowed');
      setArrivals((now) => (now.length > 0 ? now : firstArrivals(at + (FIRST_SEND - ASK_FOR))));
      setUntil((u) => Math.max(u, at + (FIRST_SEND - ASK_FOR) + RUN_END - FIRST_SEND));
    },
    [],
  );

  // The first play allows the phone by itself once it has asked for a moment.
  useEffect(() => {
    if (auto.current && answer === 'asking' && clock >= ASK_FOR) {
      auto.current = false;
      allow(clock);
    }
  }, [answer, clock, allow]);

  const answerPhone = (yes: boolean) => {
    if (answer !== 'asking') return;
    auto.current = false;
    if (yes) {
      allow(clock);
      return;
    }
    setAnswer('denied');
    setArrivals((now) => now.filter((a) => a.sentAt <= clock));
    setUntil(clock);
  };

  const askAgain = () => {
    auto.current = false;
    setAnswer('asking');
  };

  /** The phone's Choose from Files or Choose from Photos: its next two clips leave in turn. */
  const send = (from: Arrival['from']) => {
    if (answer !== 'allowed') return;
    const ids = nextClips(arrivals);
    if (ids.length === 0) return;
    const start = Math.max(clock, ...arrivals.map((a) => a.sentAt)) + 150;
    const added = ids.map((clipId, i) => ({ clipId, sentAt: start + i * SEND_EVERY, from }));
    const next = [...arrivals, ...added];
    setArrivals(next);
    setUntil(settledAt(next));
  };

  return {
    box,
    phase,
    ran,
    answer,
    arrivals,
    clock,
    /** Whether the phone has another clip to send. */
    more: nextClips(arrivals).length > 0,
    replay: run,
    answerPhone,
    askAgain,
    send,
  };
}

export type WifiRun = ReturnType<typeof useWifiRun>;
