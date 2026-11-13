// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { boxOf, type Box, type Ghost } from '#components/demo/flight-layer';
import { spriteStyle } from '../frames';
import type { ArrivalPhase } from '../use-arrival';
import { DEFAULT_ROLL, rollById, type RollId, stillOf, type TemplateSlot } from './template';

/** A 9:16 box as tall as `box`, centred on it: a clip's picture never stretches in flight. */
function portrait(box: Box, height = box.h): Box {
  const w = (height * 9) / 16;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - height / 2, w, h: height };
}

/**
 * Filling the template from a camera roll: the chosen roll, how many slots hold their clip, and the clips in flight.
 * A roll's clips leave its highlight one a half beat (the reel's own tempo) and land in their slots in order, each
 * with the rose ring; the empty roll empties the template. Under reduced motion every slot fills at once. On a narrow
 * screen, where the frames sit in a sideways row, the row brings the template into view for the flights, then your
 * version once they've landed. The server HTML, and a stage already on screen at load, rest filled from the default
 * roll; a stage below the fold waits empty and fills when it is scrolled to.
 */
export function useTemplateFill(slots: readonly TemplateSlot[], tempo: number, phase: ArrivalPhase) {
  const reduce = useReducedMotionPref();
  const [rollId, setRollId] = useState<RollId>(DEFAULT_ROLL);
  const [landed, setLanded] = useState(slots.length);
  const [bursts, setBursts] = useState<ReadonlySet<number>>(new Set());
  const [ghosts, setGhosts] = useState<readonly Ghost[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const frames = useRef<(HTMLElement | null)[]>([]);
  const bands = useRef<(HTMLLIElement | null)[]>([]);
  const covers = useRef(new Map<RollId, HTMLSpanElement>());
  const timers = useRef<number[]>([]);
  const flying = useRef(new Map<string, number>());
  const flights = useRef(0);

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    flying.current.clear();
  }, []);
  useEffect(() => clear, [clear]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  /** Brings frame `i` (0 the saved reel, 1 the template, 2 your version) into the sideways row's view; whether it moved. */
  const reveal = useCallback(
    (i: number): boolean => {
      const scroller = row.current;
      const el = frames.current[i];
      if (!scroller || !el || scroller.scrollWidth <= scroller.clientWidth + 1) return false;
      const left = el.offsetLeft - (scroller.clientWidth - el.offsetWidth) / 2;
      if (Math.abs(scroller.scrollLeft - left) < 4) return false;
      scroller.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
      return true;
    },
    [reduce],
  );

  const landAt = (i: number, last: boolean) => {
    setLanded((n) => Math.max(n, i + 1));
    setBursts((s) => new Set([...s, i]));
    later(() => setBursts((s) => new Set([...s].filter((b) => b !== i))), 520);
    if (last) later(() => reveal(2), 420);
  };

  const launch = (id: RollId, i: number, last: boolean) => {
    const root = stage.current;
    const band = bands.current[i];
    const cover = covers.current.get(id);
    const pick = rollById(id).picks[i];
    const still = stillOf(pick?.clipId);
    if (!root || !band || !cover || still === undefined) {
      landAt(i, last);
      return;
    }
    const to = boxOf(band, root);
    const from = boxOf(cover, root);
    flights.current += 1;
    const key = `${id}-${i}-${flights.current}`;
    flying.current.set(key, i);
    setGhosts((g) => [
      ...g,
      {
        id: key,
        kind: 'clip',
        from: portrait(from),
        to: portrait(to, Math.max(18, to.h)),
        style: spriteStyle(still),
      },
    ]);
  };

  const onLanded = (key: string) => {
    const i = flying.current.get(key);
    setGhosts((g) => g.filter((ghost) => ghost.id !== key));
    if (i === undefined) return;
    flying.current.delete(key);
    landAt(i, i === slots.length - 1);
  };

  // Set once the arrival has run, or the visitor chose a roll before it could: it never overrides their choice.
  const arrived = useRef(false);

  const fill = (id: RollId) => {
    const roll = rollById(id);
    arrived.current = true;
    clear();
    setGhosts([]);
    setBursts(new Set());
    setRollId(id);
    if (roll.picks.length === 0) {
      setLanded(0);
      reveal(1);
      return;
    }
    if (reduce) {
      setLanded(slots.length);
      return;
    }
    setLanded(0);
    const wait = reveal(1) ? 420 : 80;
    const halfBeat = (30 / tempo) * 1000;
    roll.picks.forEach((_, i) =>
      later(() => launch(id, i, i === roll.picks.length - 1), wait + i * halfBeat),
    );
  };

  // The arrival: below the fold the template waits empty; scrolled to, the default roll's clips fly in.
  useEffect(() => {
    if (arrived.current) return;
    if (phase === 'waiting') setLanded(0);
    if (phase === 'play') fill(DEFAULT_ROLL);
    // fill is recreated each render; the arrival runs once, on the phase alone.
  }, [phase]);

  return {
    reduce,
    roll: rollById(rollId),
    landed,
    bursts,
    ghosts,
    fill,
    onLanded,
    refs: {
      stage,
      row,
      frame: (i: number) => (el: HTMLElement | null) => {
        frames.current[i] = el;
      },
      band: (i: number) => (el: HTMLLIElement | null) => {
        bands.current[i] = el;
      },
      cover: (id: RollId) => (el: HTMLSpanElement | null) => {
        if (el) covers.current.set(id, el);
        else covers.current.delete(id);
      },
    },
  };
}
