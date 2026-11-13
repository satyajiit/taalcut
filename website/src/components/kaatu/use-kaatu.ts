// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import type { MotionValue } from 'motion/react';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { finePointer } from '#lib/pointer';
import { KaatuEngine, type KaatuPart } from './kaatu-engine';
import { LEAN, directionToward, leanToward } from './kaatu-look';
import { LIFE, moodScript } from './kaatu-moods';
import { arrivalSheets, contactSheets, loadSheets } from './kaatu-sheets';
import { DomView } from './kaatu-view';
import { useOnScreen } from './use-on-screen';

/**
 * What makes Kaatu dance: a MotionValue that changes on every music beat (a beat count, say), or a subscribe
 * function that calls back on each beat and returns its unsubscribe.
 */
export type KaatuBeat = MotionValue<number> | ((onBeat: () => void) => () => void);

export interface KaatuElements {
  /** The outer element: the button when interactive, else the drawing itself. Its box is what the pointer aims at. */
  readonly root: RefObject<HTMLElement | null>;
  readonly art: RefObject<HTMLElement | null>;
  readonly stage: RefObject<HTMLElement | null>;
  readonly breath: RefObject<HTMLElement | null>;
  readonly lean: RefObject<HTMLElement | null>;
  readonly notes: RefObject<HTMLElement | null>;
}

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Runs one Kaatu: its engine (kaatu-engine.ts) on one requestAnimationFrame, which sleeps between events and stops
 * entirely while Kaatu is off screen or the tab is hidden. The atlases its life needs load when it first comes on
 * screen, and the ones pointing and poking need on first contact. Returns the poke and hover handlers for the button.
 */
export function useKaatu(part: KaatuPart, follows: boolean, beat: KaatuBeat | undefined, el: KaatuElements) {
  const { pose, mood, toward, reduce } = part;
  const engine = useRef<KaatuEngine | null>(null);
  const wake = useRef<() => void>(() => undefined);
  const lean = useRef({ x: 0, y: 0, r: 0, tx: 0, ty: 0, tr: 0 });
  const first = useRef(part);
  const active = useOnScreen(el.root);
  const [primed, setPrimed] = useState(false);
  const dancing = beat !== undefined;

  useBrowserLayoutEffect(() => {
    const art = el.art.current;
    const stage = el.stage.current;
    const breath = el.breath.current;
    if (!art || !stage || !breath) return undefined;
    engine.current = new KaatuEngine(first.current, new DomView({ art, stage, breath, notes: el.notes.current }));
    return () => {
      engine.current?.pause();
      engine.current = null;
    };
  }, [el]);

  useBrowserLayoutEffect(() => {
    engine.current?.set({ pose, mood, toward, reduce }, performance.now());
    wake.current();
  }, [pose, mood, toward, reduce]);

  // The sheets its own life plays, loaded the first time it is on screen; the engine starts once they are in.
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    void loadSheets(arrivalSheets({ pose, mood, toward }, dancing)).then(() => {
      if (live) setPrimed(true);
    });
    return () => {
      live = false;
    };
  }, [active, pose, mood, toward, dancing]);

  // The loop: one requestAnimationFrame while something moves, a timer to the next event while nothing does.
  useEffect(() => {
    const kaatu = engine.current;
    const breath = el.breath.current;
    const art = el.art.current;
    if (!kaatu) return undefined;
    if (!active || !primed) {
      kaatu.pause();
      breath?.setAttribute('data-paused', '');
      return undefined;
    }
    breath?.removeAttribute('data-paused');
    let raf = 0;
    let timer = 0;
    const stepLean = (): boolean => {
      const s = lean.current;
      const node = el.lean.current;
      if (!node) return false;
      const moving = Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y) + Math.abs(s.tr - s.r) > 0.02;
      if (!moving && s.x === s.tx && s.y === s.ty && s.r === s.tr) return false;
      if (moving) {
        s.x += (s.tx - s.x) * LEAN.ease;
        s.y += (s.ty - s.y) * LEAN.ease;
        s.r += (s.tr - s.r) * LEAN.ease;
      } else {
        s.x = s.tx;
        s.y = s.ty;
        s.r = s.tr;
      }
      node.style.transform = s.x || s.y || s.r ? `translate(${s.x.toFixed(2)}%, ${s.y.toFixed(2)}%) rotate(${s.r.toFixed(2)}deg)` : '';
      return moving;
    };
    const loop = () => {
      raf = 0;
      const now = performance.now();
      const next = kaatu.tick(now);
      const leaning = stepLean();
      if (leaning || next - now < 40) raf = window.requestAnimationFrame(loop);
      else if (Number.isFinite(next)) timer = window.setTimeout(nudge, Math.max(0, next - now - 12));
    };
    const nudge = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (!raf) raf = window.requestAnimationFrame(loop);
    };
    wake.current = nudge;
    kaatu.resume(performance.now());
    art?.setAttribute('data-running', '');
    nudge();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      wake.current = () => undefined;
      kaatu.pause();
      art?.removeAttribute('data-running');
      breath?.setAttribute('data-paused', '');
    };
  }, [active, primed, el]);

  // Input: any pointer, key or touch resets the doze clock; a following Kaatu (interactive, or decoration that follows)
  // on a mouse or trackpad looks and leans.
  const listens = follows || (!pose && moodScript(mood, toward).life === 'idle');
  useEffect(() => {
    const kaatu = engine.current;
    if (!kaatu || !active || !primed || reduce || !listens) return undefined;
    const follow = follows && finePointer();
    let reached = false;
    const aim = (x: number, y: number) => {
      const box = el.root.current?.getBoundingClientRect();
      if (!box) return;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height * 0.45;
      const now = performance.now();
      const direction = directionToward(cx, cy, x, y);
      if (direction) kaatu.look(direction, now);
      else {
        kaatu.look(null, now);
        kaatu.input(now);
      }
      const [tx, ty, tr] = leanToward(cx, cy, x, y);
      Object.assign(lean.current, { tx, ty, tr });
      if (direction && !reached) {
        reached = true;
        void loadSheets(contactSheets());
      }
    };
    const onMove = (event: PointerEvent) => {
      if (follow && (event.pointerType === 'mouse' || event.pointerType === 'pen')) aim(event.clientX, event.clientY);
      else kaatu.input(performance.now());
      wake.current();
    };
    const onInput = () => {
      kaatu.input(performance.now());
      wake.current();
    };
    const onLeave = () => {
      Object.assign(lean.current, { tx: 0, ty: 0, tr: 0 });
      kaatu.look(null, performance.now());
      wake.current();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('keydown', onInput);
    window.addEventListener('touchstart', onInput, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('touchstart', onInput);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      Object.assign(lean.current, { tx: 0, ty: 0, tr: 0 });
    };
  }, [active, primed, reduce, listens, follows, el]);

  // Dancing: every beat is a bop and a note.
  useEffect(() => {
    const kaatu = engine.current;
    if (!beat || !kaatu || !active || !primed || reduce) return undefined;
    const onBeat = () => {
      kaatu.beat(performance.now());
      wake.current();
    };
    return typeof beat === 'function' ? beat(onBeat) : beat.on('change', onBeat);
  }, [beat, active, primed, reduce]);

  const shyTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(shyTimer.current), []);

  const poke = useCallback(() => {
    void loadSheets(contactSheets());
    engine.current?.poke(performance.now());
    wake.current();
  }, []);

  /** First contact (hover or focus): load what pointing and poking need; a pointer that rests makes it shy. */
  const enter = useCallback((rest: boolean) => {
    void loadSheets(contactSheets());
    window.clearTimeout(shyTimer.current);
    if (!rest) return;
    shyTimer.current = window.setTimeout(() => {
      engine.current?.shy(performance.now());
      wake.current();
    }, LIFE.shy);
  }, []);

  const leave = useCallback(() => window.clearTimeout(shyTimer.current), []);

  return { poke, enter, leave };
}
