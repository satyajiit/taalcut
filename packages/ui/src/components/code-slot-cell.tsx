// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: code-slot-cell · genre: atmospheric studio app · system: DESIGN.md v0.3
 * Single slot cell and shared math helpers for CodeSlots (React Bits micro/code-slots adaptation). */

import { animate, motion, useTransform, type MotionValue } from 'motion/react';
import { useState } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_IN, EASE_OUT } from '#lib/motion';

const SINK_FADE = 0.6;

export type CodeSlotsStatus = 'idle' | 'error' | 'success';
export type CodeSlotsSize = 'sm' | 'md' | 'lg';

export function runStatusTransition(
  status: CodeSlotsStatus,
  was: CodeSlotsStatus,
  reduce: boolean | null,
  openMv: MotionValue<number>,
  checkMv: MotionValue<number>,
  drops: readonly MotionValue<number>[],
  setVeiled: (v: boolean) => void,
) {
  if (status === 'success') {
    setVeiled(true);
    if (reduce) {
      openMv.jump(1);
      drops.forEach((d) => d.jump(1));
      checkMv.jump(1);
      return;
    }
    // The wash, the digits sinking one after another, then the check: tweens on the tokens, no bounce.
    animate(openMv, 1, { duration: DUR.short, ease: EASE_OUT });
    drops.forEach((d, k) => animate(d, 1, { duration: DUR.short, ease: EASE_OUT, delay: (k * DUR.micro) / 4 }));
    animate(checkMv, 1, { duration: DUR.short, ease: EASE_OUT, delay: DUR.short });
    return;
  }
  if (was !== 'success') return;
  if (reduce) {
    openMv.jump(0);
    checkMv.jump(0);
    drops.forEach((d) => d.jump(0));
    setVeiled(false);
    return;
  }
  animate(checkMv, 0, { duration: DUR.micro, ease: EASE_IN });
  void animate(openMv, 0, { duration: DUR.micro, ease: EASE_IN, delay: DUR.micro / 2 }).then(() => {
    if (openMv.get() === 0) setVeiled(false);
  });
  drops.forEach((d) => animate(d, 0, { duration: DUR.short, ease: EASE_OUT, delay: DUR.micro }));
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const digitsOf = (raw: string | undefined) => String(raw ?? '').replace(/\D/g, '');
export const toSlots = (raw: string | undefined, n: number) => {
  const d = digitsOf(raw).slice(0, n);
  return Array.from({ length: n }, (_, i) => d[i] ?? '');
};
export const firstEmptyOf = (slots: string[]) => {
  const i = slots.indexOf('');
  return i === -1 ? slots.length - 1 : i;
};
export const isFull = (slots: string[]) => slots.every(Boolean);

export const SIZE_CONFIG = {
  sm: { slotW: 36, slotH: 44, gap: 6, font: 'text-lg' },
  md: { slotW: 42, slotH: 50, gap: 6, font: 'text-2xl' },
  lg: { slotW: 46, slotH: 54, gap: 8, font: 'text-2xl' },
} as const;

export interface SlotProps {
  mv: MotionValue<number>;
  drop: MotionValue<number>;
  char: string;
  placeholderChar: string;
  active: boolean;
  readOnly: boolean;
  size: CodeSlotsSize;
  rise: number;
  sink: number;
}

export function CodeSlotCell({
  mv,
  drop,
  char,
  placeholderChar,
  active,
  readOnly,
  size,
  rise,
  sink,
}: SlotProps) {
  const [shown, setShown] = useState(char);
  if (char !== shown) setShown(char);
  const fill = useTransform(mv, (t: number) => `scale(${Math.max(t, 0)})`);
  const lift = useTransform(
    [mv, drop],
    ([t = 0, d = 0]: number[]) => `translateY(${(1 - t) * rise + Math.max(d, 0) * sink}px)`,
  );
  const ink = useTransform(
    [mv, drop],
    ([t = 0, d = 0]: number[]) => clamp01(t) * (1 - clamp01(d / SINK_FADE)),
  );
  const cfg = SIZE_CONFIG[size];
  const filled = Boolean(char);

  return (
    <span
      translate="no"
      aria-hidden={readOnly ? undefined : true}
      data-slot="code-slot"
      data-active={active ? '' : undefined}
      data-filled={filled ? '' : undefined}
      style={{ width: `${cfg.slotW}px`, height: `${cfg.slotH}px` }}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border font-semibold select-none tabular-nums',
        'transition-[border-color,background-color] duration-(--dur-micro) ease-(--ease-out)',
        filled ? 'border-primary-strong/55 bg-raised shadow-2xs' : 'border-rule-strong bg-canvas text-ink-3',
        // The hidden input has the focus; the slot under the caret shows the base ring (base.css), at once.
        active && 'outline-2 outline-offset-2 outline-focus window-inactive:outline-transparent',
        'in-data-[status=error]:border-danger-strong in-data-[status=error]:bg-danger-soft/50',
        cfg.font,
      )}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0.5 origin-center rounded-md bg-primary-soft/55 in-data-[status=error]:bg-danger-soft/80"
        style={{ transform: fill }}
      />
      {shown ? (
        <motion.span
          className="relative z-10 grid place-items-center leading-none font-semibold text-ink tabular-nums motion-reduce:transform-none!"
          style={{ transform: lift, opacity: ink }}
        >
          {shown}
        </motion.span>
      ) : placeholderChar ? (
        <span aria-hidden className="relative z-10 text-lg font-medium text-ink-3 select-none">
          {placeholderChar}
        </span>
      ) : null}
    </span>
  );
}
