// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: hero stage · mode: Persuade (the signature interaction) · system: WEB2 Remix Vernacular
 * The saved reel and the coded app window side by side (stacked on a phone), and the flights between them. On arrival,
 * or when Use template is pressed, the reel's segment bar lifts off and flies into the window as the template strip,
 * clips leave the camera roll's stack for their slots one per beat with a rose ring on each, the list stepping down
 * through all 13 as they land, the meters fill, and Approve opens; Approve turns the reel to Your version under the
 * same bar. Another saved reel (the carousel, `?reel=`) re-cuts the window on its beats. From 1280 px the reel takes a
 * fixed width (about a fifth of the screen) and the window the rest; `under` sits beneath the reel on a phone only.
 * states: data-phase shelf · lift · template · sift · assembled · ready · approved · data-view saved | yours ·
 *   data-playing (the visitor's Pause on the reel stops the pass too) · reduced motion (the finished pass at once,
 *   150 ms fades, nothing flies) · without JavaScript (the reel's poster under its bar, the window waiting)
 * motion: one orchestrated pass on the reel's beats (the page's one arrival); the flights are ghosts drawn above both
 *   frames (flight-layer.tsx), transform only. */

import { animate, MotionConfig, useMotionValue } from 'motion/react';
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { CAMERA_ROLL, REELS, SAMPLE_REELS, reelById } from '#content/reels';
import { useDemoStore } from '#stores/demo';
import { boxOf, FlightLayer, type Ghost } from '#components/demo/flight-layer';
import { HeroReel } from '#components/demo/hero-reel';
import { listScrollTop, slotRows } from '#components/demo/hero-model';
import { MakeWindow } from '#components/demo/make-window';
import { reached } from '#components/demo/pass';
import { cropStyle, shownDays, slotPicks, spriteStyle } from '#components/demo/roll';
import { THUMB_ASPECT, VISIBLE_ROWS } from '#components/demo/slot-list';
import { Shelf } from './shelf';
import { usePassConductor, useReelParam } from './use-pass';

/** The days the roll can draw on; stable across reels. */
const DAYS = shownDays(CAMERA_ROLL, SAMPLE_REELS, 8);
const SPRITES = new Map(CAMERA_ROLL.clips.map((c) => [c.id, c.sprite]));
const EMPTY: ReadonlySet<number> = new Set();

export function Stage({ under }: { readonly under?: ReactNode }) {
  const reelId = useDemoStore((s) => s.reelId);
  const phase = useDemoStore((s) => s.phase);
  const landed = useDemoStore((s) => s.landed);
  const read = useDemoStore((s) => s.read);
  const run = useDemoStore((s) => s.run);
  const view = useDemoStore((s) => s.view);
  const playing = useDemoStore((s) => s.playing);
  const reduce = useReducedMotionPref();

  const reel = reelById(reelId);
  const picks = useMemo(() => slotPicks(reel, DAYS).picks, [reel]);
  const rows = useMemo(() => slotRows(reel), [reel]);
  const thumbs = useMemo(() => picks.map((id) => cropStyle(CAMERA_ROLL.atlas, SPRITES.get(id) ?? 0, THUMB_ASPECT)), [picks]);
  const stills = useMemo(() => picks.map((id) => spriteStyle(CAMERA_ROLL.atlas, SPRITES.get(id) ?? 0)), [picks]);

  const reelTime = useMotionValue(0);
  const stripTime = useMotionValue(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const flown = useRef(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [ghosts, setGhosts] = useState<readonly Ghost[]>([]);
  const [barLanded, setBarLanded] = useState(false);
  const [arrived, setArrived] = useState<ReadonlySet<number>>(EMPTY);
  const [lastArrived, setLastArrived] = useState(-1);
  useReelParam();
  usePassConductor(root);

  // A new pass (Use template, another reel): nothing in flight, nothing landed, the list back at its top.
  useLayoutEffect(() => {
    flown.current = 0;
    setGhosts([]);
    setBarLanded(false);
    setArrived(EMPTY);
    setLastArrived(-1);
    stripTime.set(0);
    list.current?.scrollTo({ top: 0 });
  }, [run, reelId, stripTime]);

  // The template lifts off the reel and flies into the window.
  useLayoutEffect(() => {
    if (!reached(phase, 'template') || barLanded) return;
    const r = root.current;
    const from = r?.querySelector('[data-flight-from="bar"]');
    const to = r?.querySelector('[data-flight-to="bar"]');
    if (reduce || !r || !from || !to) {
      setBarLanded(true);
      return;
    }
    const id = `bar-${run}`;
    const ghost: Ghost = { id, kind: 'bar', from: boxOf(from, r), to: boxOf(to, r), count: reel.slots.length };
    setGhosts((now) => (now.some((g) => g.id === id) ? now : [...now, ghost]));
  }, [phase, barLanded, reduce, run, reel]);

  // A clip flies from the roll's stack into each slot as its pick lands; the list keeps the landing row in view.
  useLayoutEffect(() => {
    const r = root.current;
    const box = list.current;
    if (reduce || !r) {
      if (landed > 0) setArrived(new Set(Array.from({ length: landed }, (_, i) => i)));
      flown.current = landed;
      return;
    }
    const next: Ghost[] = [];
    const now = new Set<number>();
    for (let i = flown.current; i < landed; i++) {
      const tile = r.querySelector('[data-flight-from="roll"]');
      const thumb = r.querySelector(`[data-flight-to="clip-${i}"]`);
      if (!tile || !thumb || !box) {
        now.add(i);
        continue;
      }
      const rowHeight = (thumb.closest('li') as HTMLElement | null)?.offsetHeight ?? 0;
      const top = listScrollTop(i, rowHeight, VISIBLE_ROWS, reel.slots.length);
      const dy = box.scrollTop - top;
      box.scrollTo({ top, behavior: 'smooth' });
      next.push({ id: `clip-${run}-${i}`, kind: 'clip', from: boxOf(tile, r), to: boxOf(thumb, r, dy), style: thumbs[i] ?? {} });
    }
    flown.current = Math.max(flown.current, landed);
    if (next.length) setGhosts((g) => [...g, ...next]);
    if (now.size) setArrived((a) => new Set([...a, ...now]));
  }, [landed, reduce, run, reel, thumbs]);

  // Every slot filled: the list goes back to its first row, where the reel starts (an Approve straight away too).
  const done = reached(phase, 'ready');
  useLayoutEffect(() => {
    if (!done) return undefined;
    const timer = window.setTimeout(() => list.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }), reduce ? 0 : 700);
    return () => window.clearTimeout(timer);
  }, [done, reduce]);

  // The strip fills as each pick lands, stories style.
  useLayoutEffect(() => {
    if (lastArrived < 0) return undefined;
    const end = reel.slots[lastArrived]?.end ?? 0;
    const controls = animate(stripTime, end, { duration: reduce ? 0 : 0.24, ease: 'linear' });
    return () => controls.stop();
  }, [lastArrived, reel, reduce, stripTime]);

  const onLanded = useCallback((id: string) => {
    setGhosts((g) => g.filter((x) => x.id !== id));
    if (id.startsWith('bar-')) {
      setBarLanded(true);
      return;
    }
    const slot = Number(id.split('-').at(-1));
    setArrived((a) => new Set([...a, slot]));
    setLastArrived((n) => Math.max(n, slot));
  }, []);

  const store = useDemoStore.getState;
  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={root}
        data-stage=""
        data-phase={phase}
        data-view={view}
        data-playing={playing}
        className="relative grid min-w-0 grid-cols-1 items-start justify-items-center gap-x-5 gap-y-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:justify-items-stretch lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] xl:grid-cols-[auto_minmax(0,1fr)] xl:items-center"
      >
        <div className="relative z-20 flex w-[78vw] max-w-[22rem] flex-col gap-4 md:w-full md:max-w-none xl:w-[clamp(15rem,20vw,18.5rem)]">
          <HeroReel
            reel={reel}
            phase={phase}
            view={view}
            run={run}
            barLanded={barLanded}
            reelTime={reelTime}
            videoPlaying={videoPlaying}
            picks={picks}
            stills={stills}
            reduce={reduce}
            onUseTemplate={() => store().replay()}
            onView={(v) => store().setView(v)}
            onPlayingChange={setVideoPlaying}
            // The frame's own Pause/Play is the visitor's pause for the pass too.
            onPausedChange={(paused) => store().setPlaying(!paused)}
          />
          <Shelf reels={REELS} chosenId={reel.id} onChoose={(id) => store().chooseReel(id)} />
        </div>
        {under ? <div className="-mt-4 w-full sm:hidden">{under}</div> : null}
        <MakeWindow
          reel={reel}
          roll={CAMERA_ROLL}
          rows={rows}
          thumbs={thumbs}
          phase={phase}
          landed={landed}
          read={read}
          barLanded={barLanded}
          arrived={arrived}
          lastArrived={lastArrived}
          stripTime={stripTime}
          reelTime={reelTime}
          reduce={reduce}
          listRef={list}
          onApprove={() => store().approve()}
          className="relative z-10 w-full"
        />
        <FlightLayer ghosts={ghosts} onLanded={onLanded} />
      </div>
    </MotionConfig>
  );
}
