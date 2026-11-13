// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: select · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * states: default (raised surface, rule-strong edge, custom dual-chevron) · hover (hover surface, edge ink-3)
 *   · focus (base ring, instant) · active (pressed surface) · disabled (sunken, ink-disabled)
 *   · loading (aria-busy, spinner replaces chevron) · error (danger-strong edge, aria-invalid) */

import { ChevronsUpDown, LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface SelectProps extends ComponentProps<'select'> {
  /** Optional leading icon or badge (such as a ProviderLogo) shown inside the left edge of the control. */
  leading?: ReactNode;
  wrapperClassName?: string;
}

/**
 * Studio select control: custom surface, optional leading icon/logo, and dual-chevron
 * indicator while keeping native keyboard, screen-reader, and macOS menu behaviour.
 */
export function Select({ leading, className, wrapperClassName, disabled, ...props }: SelectProps) {
  const busy = props['aria-busy'] === true || props['aria-busy'] === 'true';
  return (
    <div
      data-slot="select-wrapper"
      className={cn('relative inline-flex w-full min-w-0 items-center', wrapperClassName)}
    >
      {leading ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-2.5 flex items-center justify-center',
            disabled && 'opacity-50',
          )}
        >
          {leading}
        </span>
      ) : null}
      <select
        disabled={disabled}
        data-slot="select"
        className={cn(
          'h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-rule-strong bg-raised pr-8 type-label text-ink shadow-xs',
          leading ? 'pl-8' : 'pl-3',
          'transition-[border-color,background-color] duration-(--dur-micro) ease-(--ease-out)',
          'hover:border-ink-3 hover:bg-hover focus-visible:border-ink-2 active:bg-pressed',
          'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:text-ink-disabled disabled:shadow-none',
          'aria-busy:cursor-progress aria-invalid:border-danger-strong',
          className,
        )}
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          // 20 px round a 14 px glyph, so the spinner fits at any angle of its turn.
          'pointer-events-none absolute right-2 flex size-5 items-center justify-center text-ink-3',
          disabled && 'text-ink-disabled',
        )}
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ChevronsUpDown className="size-3.5" />}
      </span>
    </div>
  );
}
