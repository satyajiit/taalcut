// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: code-slots-motion · genre: atmospheric studio app · system: DESIGN.md v0.3
 * Motion value orchestration, gliding caret transform, and success wash overlay for CodeSlots. */

import { Check } from 'lucide-react';
import {
  animate,
  motion,
  motionValue,
  useMotionValue,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DUR, EASE_OUT } from '#lib/motion';
import { clamp01, runStatusTransition, type CodeSlotsStatus } from './code-slot-cell';

export interface UseCodeSlotsMotionOptions {
  length: number;
  pitch: number;
  active: number;
  setActive: (next: number) => void;
  status: CodeSlotsStatus;
  cascade: number;
  reduce: boolean | null;
  slotsRef: { current: string[] };
  statusRef: { current: CodeSlotsStatus };
}

export interface CodeSlotsMotion {
  mvs: MotionValue<number>[];
  drops: MotionValue<number>[];
  target: { current: number[] };
  veiled: boolean;
  caretTransform: MotionValue<string>;
  washScaleX: MotionValue<number>;
  checkY: MotionValue<number>;
  checkScale: MotionValue<number>;
  checkOpacity: MotionValue<number>;
  drive: (i: number, to: number, delayMs?: number) => void;
  land: (i: number, delayMs?: number) => void;
  moveActive: (next: number, crossed: number[]) => void;
  jumpActive: (next: number) => void;
}

export function useCodeSlotsMotion({
  length,
  pitch,
  active,
  setActive,
  status,
  cascade,
  reduce,
  slotsRef,
  statusRef,
}: UseCodeSlotsMotionOptions): CodeSlotsMotion {
  const [veiled, setVeiled] = useState(status === 'success');
  const activeMv = useMotionValue(active);
  const openMv = useMotionValue(status === 'success' ? 1 : 0);
  const checkMv = useMotionValue(status === 'success' ? 1 : 0);
  const glide = useRef<Set<number>>(new Set());
  const target = useRef<number[]>([]);
  const live = useRef({ cascade, reduce });
  live.current = { cascade, reduce };

  const { mvs, drops } = useMemo(
    () => ({
      mvs: Array.from({ length }, (_, i) => motionValue(slotsRef.current[i] ? 1 : 0)),
      drops: Array.from({ length }, () => motionValue(statusRef.current === 'success' ? 1 : 0)),
    }),
    [length, slotsRef, statusRef],
  );

  const drive = useCallback(
    (i: number, to: number, delayMs = 0) => {
      const mv = mvs[i];
      if (!mv) return;
      target.current[i] = to;
      if (live.current.reduce) return mv.jump(to);
      animate(mv, to, { duration: DUR.short, ease: EASE_OUT, delay: delayMs / 1000 });
    },
    [mvs],
  );

  const land = useCallback(
    (i: number, delayMs = 0) => {
      const mv = mvs[i];
      if (!mv) return;
      if (mv.get() > 0) mv.jump(0);
      drive(i, 1, delayMs);
    },
    [mvs, drive],
  );

  const moveActive = useCallback(
    (next: number, crossed: number[]) => {
      crossed.forEach((j) => glide.current.add(j));
      activeMv.jump(next);
      setActive(next);
    },
    [activeMv, setActive],
  );

  const jumpActive = useCallback(
    (next: number) => {
      glide.current.clear();
      activeMv.jump(next);
      setActive(next);
    },
    [activeMv, setActive],
  );

  const caretX = useTransform(() => {
    const a = activeMv.get();
    let x = a * pitch;
    for (let j = 0; j < mvs.length; j += 1) {
      const mv = mvs[j];
      if (!mv || !glide.current.has(j)) continue;
      const h = clamp01(mv.get());
      const to = target.current[j];
      if (to === undefined || h === clamp01(to)) glide.current.delete(j);
      else x += j < a ? -(1 - h) * pitch : h * pitch;
    }
    return Math.min(Math.max(x, 0), (mvs.length - 1) * pitch);
  });
  const caretTransform = useTransform(caretX, (x: number) => `translateX(${x}px)`);
  const washScaleX = useTransform(openMv, (o: number) => clamp01(o));
  const checkY = useTransform(checkMv, (c: number) => (1 - c) * 8);
  const checkScale = useTransform(checkMv, (c: number) => 0.85 + 0.15 * Math.max(c, 0));
  const checkOpacity = useTransform(checkMv, clamp01);

  useEffect(() => {
    runStatusTransition(
      status,
      statusRef.current,
      live.current.reduce,
      openMv,
      checkMv,
      drops,
      setVeiled,
    );
  }, [status, openMv, checkMv, drops, statusRef]);

  return {
    mvs,
    drops,
    target,
    veiled,
    caretTransform,
    washScaleX,
    checkY,
    checkScale,
    checkOpacity,
    drive,
    land,
    moveActive,
    jumpActive,
  };
}

export function CodeSlotsSuccessWash({
  washScaleX,
  checkY,
  checkScale,
  checkOpacity,
}: {
  washScaleX: MotionValue<number>;
  checkY: MotionValue<number>;
  checkScale: MotionValue<number>;
  checkOpacity: MotionValue<number>;
}) {
  return (
    <motion.span
      className="pointer-events-none absolute inset-0 z-10 grid origin-center place-items-center rounded-lg bg-success-soft text-success-strong"
      aria-hidden
      style={{ scaleX: washScaleX, opacity: washScaleX }}
    >
      <motion.span
        className="grid place-items-center"
        style={{ y: checkY, scale: checkScale, opacity: checkOpacity }}
      >
        <Check aria-hidden className="size-6 stroke-[2.4]" />
      </motion.span>
    </motion.span>
  );
}

export function CodeSlotsCaret({
  active,
  showCaret,
  slotW,
  caretTransform,
}: {
  active: number;
  showCaret: boolean;
  slotW: number;
  caretTransform: MotionValue<string>;
}) {
  return (
    <motion.span
      className="pointer-events-none absolute top-1/4 z-15 h-1/2 w-0.5 opacity-0 data-[show]:opacity-100"
      aria-hidden
      data-show={showCaret ? '' : undefined}
      style={{ left: `${slotW / 2 - 1}px`, transform: caretTransform }}
    >
      <span key={active} className="block size-full animate-pulse rounded-pill bg-primary-strong" />
    </motion.span>
  );
}
