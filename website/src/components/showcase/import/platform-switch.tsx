// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Mac or Ubuntu, for the window · mode: Operate · system: WEB2 Remix Vernacular (Segmented; Motion › Glide)
 * which computer the window shows: the Mac (traffic lights, every way in) or Ubuntu (GNOME's controls, Files, Folder
 *   and Phone over Wi-Fi). One pill of two options on the sunken well, each its SVGL icon beside its name, the chosen
 *   one under a raised thumb that glides there (a narrow window keeps the icons, the names read out). A radio
 *   group: Tab reaches the chosen option, the arrows move and choose, Home and End jump
 * states: default · hover (ink) · focus (base ring) · active (the pressed surface) · chosen (the thumb,
 *   aria-checked) · disabled/loading/error n/a (a view of the page)
 * motion: the thumb glides (--dur-short, ease-out); reduced motion: it moves at once */

import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import type { Platform } from './ways';

const OPTIONS: readonly { readonly value: Platform; readonly label: string; readonly brand: 'apple' | 'ubuntu' }[] = [
  { value: 'mac', label: 'Mac', brand: 'apple' },
  { value: 'ubuntu', label: 'Ubuntu', brand: 'ubuntu' },
];

export function PlatformSwitch({
  value,
  onChange,
  className,
}: {
  readonly value: Platform;
  readonly onChange: (value: Platform) => void;
  readonly className?: string;
}) {
  const thumb = useId();
  const reduce = useReducedMotionPref();
  const list = useRef<HTMLDivElement>(null);
  const choose = (next: Platform) => {
    onChange(next);
    list.current?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, Platform | undefined> = {
      ArrowLeft: 'mac',
      ArrowUp: 'mac',
      Home: 'mac',
      ArrowRight: 'ubuntu',
      ArrowDown: 'ubuntu',
      End: 'ubuntu',
    };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    choose(next);
  };
  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label="Show the app on"
      onKeyDown={onKeyDown}
      className={cn('inline-flex w-fit shrink-0 rounded-pill bg-sunken p-0.5', className)}
    >
      {OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={option.value}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(option.value)}
            className={cn(
              'relative inline-flex h-8 items-center rounded-pill px-3 type-label-sm whitespace-nowrap select-none',
              'transition-colors duration-(--dur-micro) ease-(--ease-out)',
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
            <span data-slot="icon-text" className="relative inline-flex items-center gap-1.5">
              <BrandIcon id={option.brand} className="size-3.5" />
              <span className="sr-only @min-[30rem]:not-sr-only">{option.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
