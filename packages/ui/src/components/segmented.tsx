// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: segmented control · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a radio group as one pill: the chosen option on a raised thumb that glides between options on --dur-short,
 *   --ease-out, no overshoot. Transform only (v0.4, UX1): the thumb is two end caps that move and a middle that
 *   moves and stretches (scaleX), so options of different widths glide without animating width or height. Not a
 *   shared-layout animation: in a long chat those measure every laid-out element on the page and drop frames.
 * states: default · hover (ink) · focus (base ring on the option, instant) · active (ink) · disabled (the whole group
 *   or one option: ink-disabled, skipped by arrows) · loading (aria-busy on the group; the thumb holds) · error (danger
 *   edge round the group, aria-invalid; the caller says why under it) · success (the choice is the answer)
 * reduced motion: the thumb moves at once (base.css) */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { HOVER_EASE } from '#lib/motion-classes';
import { SegmentThumb, useThumb } from './segment-thumb';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * The group's accessible name: a string, or the id of an element that names it. Use the id when the name carries
 * the person's own words (a session's name inside a translated sentence), so they can sit in a `translate="no"` span.
 */
export type SegmentedName = { label: string; labelledBy?: never } | { labelledBy: string; label?: never };

export type SegmentedProps<T extends string> = SegmentedName & {
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  busy?: boolean;
  invalid?: boolean;
  className?: string;
};

/** A small set of choices where one is picked: arrow keys move and pick, as a radio group does. */
export function Segmented<T extends string>({
  label,
  labelledBy,
  value,
  options,
  onChange,
  disabled = false,
  busy = false,
  invalid = false,
  className,
}: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const groupRef = useRef<HTMLDivElement>(null);
  // The thumb follows the checked option (aria-checked), measured after layout and on every resize.
  const thumb = useThumb(groupRef, '[role=radio][aria-checked=true]');
  const enabled = options.filter((option) => !option.disabled && !disabled);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if ((!forward && !back) || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((option) => option.value === value);
    const next = enabled[(at + (forward ? 1 : -1) + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  }

  const focusable =
    value !== null && enabled.some((option) => option.value === value) ? value : enabled[0]?.value;
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-busy={busy || undefined}
      aria-invalid={invalid || undefined}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-pill border border-rule bg-sunken p-0.5',
        invalid && 'border-danger-strong',
        className,
      )}
    >
      {thumb ? <SegmentThumb {...thumb} /> : null}
      {options.map((option, i) => {
        const checked = option.value === value;
        const off = disabled || option.disabled === true;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={off || undefined}
            tabIndex={option.value === focusable ? 0 : -1}
            onClick={() => {
              if (!off && !busy) onChange(option.value);
            }}
            className={cn(
              'relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill px-3 type-label whitespace-nowrap',
              HOVER_EASE,
              checked ? 'text-ink' : 'text-ink-2 hover:text-ink active:text-ink',
              off && 'cursor-not-allowed text-ink-disabled hover:text-ink-disabled',
            )}
          >
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
