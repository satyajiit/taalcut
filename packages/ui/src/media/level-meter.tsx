// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: level meter · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * how loud the microphone hears you while a consent records: a teal fill (you) on a sunken track, plus a thin
 *   minute bar under it that fills to the 60 s the check needs and turns success-green at a minute
 * states: idle (empty track) · live (the fill follows the level on scale, ~20 updates a second, a CSS variable
 *   written straight to the element so the card doesn't re-render) · minute reached (green) · not interactive (no hover, focus or
 *   active); reduced motion: no easing on the fill, the level still shows
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { useEffect, useRef } from 'react';
import { cn } from '#lib/cn';

export interface LevelMeterProps {
  /** Calls back with 0 to 1 while recording; returns the unsubscribe. */
  subscribe: (listener: (level: number) => void) => () => void;
  /** 0 to 1 of the minute the check needs. */
  minute: number;
  className?: string;
}

export function LevelMeter({ subscribe, minute, className }: LevelMeterProps) {
  const { t } = useLingui();
  const fill = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      subscribe((level) => {
        const clamped = Math.min(1, Math.max(0, level));
        fill.current?.style.setProperty('--level', String(clamped));
      }),
    [subscribe],
  );
  const reached = minute >= 1;
  return (
    <div data-slot="level-meter" className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs text-ink-2">{t`Microphone level`}</span>
      <span aria-hidden className="relative block h-2.5 overflow-hidden rounded-pill bg-sunken">
        <span
          ref={fill}
          data-slot="level-fill"
          className="absolute inset-0 origin-left scale-x-(--level) rounded-pill bg-you transition-[scale] duration-75 ease-linear [--level:0] motion-reduce:transition-none rtl:origin-right"
        />
      </span>
      <span aria-hidden className="relative block h-1 overflow-hidden rounded-pill bg-sunken">
        <span
          data-slot="minute-fill"
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, minute))})` }}
          className={cn(
            'absolute inset-0 origin-left rounded-pill transition-transform duration-(--dur-short) ease-linear motion-reduce:transition-none rtl:origin-right',
            reached ? 'bg-success-strong' : 'bg-ink-3',
          )}
        />
      </span>
    </div>
  );
}
