// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: segmented choice · mode: Operate · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Segmented; Motion › Glide)
 * a value from a short set of words: one pill of options on the sunken well, one raised thumb with a rule-strong
 * edge under the chosen one, which glides there by transform alone. A radio group: Tab reaches the chosen option,
 * the arrows move and choose, Home and End jump.
 * states: default · hover (ink) · focus (base ring, instant) · active (the pressed surface) · chosen (the thumb,
 *   aria-checked) · disabled (ink-disabled, skipped by the arrows) · loading/error/success: n/a (a value)
 * motion: the thumb glides (--dur-short, ease-out); reduced motion: it moves at once */

import { motion, useReducedMotion } from 'motion/react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** The group's name, read out with each option. */
  readonly label: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly className?: string;
}) {
  const thumb = useId();
  const reduce = useReducedMotion();
  const list = useRef<HTMLDivElement>(null);
  const enabled = options.filter((option) => !option.disabled);

  const choose = (next: T) => {
    onChange(next);
    list.current?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.findIndex((option) => option.value === value);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    let target: SegmentedOption<T> | undefined;
    if (step !== 0) target = enabled[(at + step + enabled.length) % enabled.length];
    else if (event.key === 'Home') target = enabled[0];
    else if (event.key === 'End') target = enabled[enabled.length - 1];
    if (!target) return;
    event.preventDefault();
    choose(target.value);
  };

  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex w-fit max-w-full rounded-pill bg-sunken p-0.5', className)}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={option.value}
            disabled={option.disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(option.value)}
            className={cn(
              'relative inline-flex h-8 items-center justify-center rounded-pill px-3 type-label-sm whitespace-nowrap select-none',
              'transition-colors duration-(--dur-micro) ease-(--ease-out) disabled:text-ink-disabled',
              checked ? 'text-ink' : 'text-ink-2 hover:text-ink active:bg-pressed',
            )}
          >
            {checked ? (
              <motion.span
                aria-hidden
                layoutId={thumb}
                transition={reduce ? { duration: 0 } : { duration: DUR.short, ease: EASE_OUT }}
                className="absolute inset-0 rounded-pill border border-rule-strong bg-raised shadow-xs"
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
