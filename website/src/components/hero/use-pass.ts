// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from '#components/brand/use-reduced-motion';
import { REELS, reelById } from '#content/reels';
import { useDemoStore } from '#stores/demo';
import { beatIndexAt, beatLength, momentAt, passPlan, passStart, phaseIndex } from '#components/demo/pass';

/**
 * The stage's conductor: plays the signature interaction on the reel's beats and writes the demo store as it goes
 * (phase, picks landed, music beats read, the beat). Its clock runs only while the visitor hasn't paused, the stage
 * is on screen and the tab is visible, so a visitor who scrolls away comes back to where they left. Phases only move
 * forward and stop at `ready`: Approve is the visitor's. A new pass (Use template, another reel) bumps `run`, which
 * starts the clock again from the lift. Under reduced motion the pass is finished at once.
 */
export function usePassConductor(stageRef: RefObject<HTMLElement | null>): void {
  const reelId = useDemoStore((s) => s.reelId);
  const run = useDemoStore((s) => s.run);

  useEffect(() => {
    const store = useDemoStore.getState;
    if (prefersReducedMotion()) {
      store().settle();
      return undefined;
    }
    const reel = reelById(reelId);
    const plan = passPlan(reel);
    let elapsed = passStart(plan, run);

    let visible = true;
    // On screen once its top is a fifth of the way up the viewport (the stage is taller than a phone's screen).
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => (visible = entry?.isIntersecting ?? true), { rootMargin: '0px 0px -20% 0px' });
    if (stageRef.current) observer?.observe(stageRef.current);

    let last = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const s = store();
      if (s.playing && visible && !document.hidden) elapsed += dt;
      const moment = momentAt(plan, elapsed);
      if (phaseIndex(moment.phase) > phaseIndex(s.phase)) s.setPhase(moment.phase);
      if (moment.landed > s.landed) s.setLanded(moment.landed);
      const read = moment.reading >= 1 ? reel.beats.length - 1 : moment.reading > 0 ? beatIndexAt(reel, moment.reading * reel.durationSec) : -1;
      if (read > s.read) s.setRead(read);
      const beat = Math.floor(elapsed / beatLength(reel));
      if (beat !== s.beat) s.setBeat(beat);
      // The pass is over once Approve opens: nothing left to time.
      if (elapsed <= plan.total) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [reelId, run, stageRef]);
}

/**
 * Every reel has an address: `/?reel=<id>` opens that cut (an Instagram link can point at one), and choosing a reel
 * writes it back with replaceState, so Back still leaves the page. Read once, on mount: the static HTML can't know
 * the query, so it always shows the default reel first.
 */
export function useReelParam(): void {
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('reel');
      if (id && REELS.some((r) => r.id === id)) useDemoStore.getState().chooseReel(id);
    } catch {
      // A malformed address keeps the default reel.
    }
    return useDemoStore.subscribe((state, prev) => {
      if (state.reelId === prev.reelId) return;
      const url = new URL(window.location.href);
      url.searchParams.set('reel', state.reelId);
      window.history.replaceState(window.history.state, '', url);
    });
  }, []);
}
