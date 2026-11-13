// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: cost period switch · mode: Persuade · system: WEB2 Remix Vernacular
 * states: A month (default, chosen) · A year · each choice: default (ink-2 on the control track) · hover (ink) ·
 *   focus (base ring, on the chosen one: a roving radio group, the arrow keys move and choose) · active (2 % give) ·
 *   chosen (a raised face slides under it; at once under reduced motion). Nothing to disable, load or fail.
 * The cost board's one control: whether its figures are for a month or a year. The bars keep their lengths (a year is
 * twelve months of each price); the figures and the stickers change. */

import { motion } from 'motion/react';
import { type KeyboardEvent, useId, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { COST_SECTION, type CostPeriod } from '#content/cost';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';

const ORDER: readonly CostPeriod[] = ['month', 'year'];

export function PeriodSwitch({ value, onChange, className }: { readonly value: CostPeriod; readonly onChange: (p: CostPeriod) => void; readonly className?: string }) {
  const reduce = useReducedMotionPref();
  const face = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (ORDER.indexOf(value) + step + ORDER.length) % ORDER.length;
    onChange(ORDER[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={COST_SECTION.periods.group}
      onKeyDown={onKey}
      data-slot="cost-period"
      className={cn('inline-flex shrink-0 rounded-pill bg-control p-1 ring-1 ring-rule-subtle ring-inset', className)}
    >
      {ORDER.map((p, i) => {
        const chosen = p === value;
        return (
          <button
            key={p}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(p)}
            className={cn(
              'relative inline-flex h-9 items-center rounded-pill px-4 type-label font-semibold whitespace-nowrap select-none',
              'transition-[color,transform] duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100',
              chosen ? 'text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            {chosen ? (
              <motion.span
                layoutId={face}
                aria-hidden
                className="absolute inset-0 rounded-pill bg-raised shadow-sticker ring-1 ring-rule"
                transition={reduce ? { duration: 0 } : { duration: DUR.short, ease: EASE_OUT }}
              />
            ) : null}
            <span className="relative">{COST_SECTION.periods[p]}</span>
          </button>
        );
      })}
    </div>
  );
}
