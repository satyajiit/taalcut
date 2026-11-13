// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: input · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * states: default (raised surface, rule-strong edge) · hover (edge ink-3) · focus (canvas surface, edge ink-2,
 *   base focus ring) · active (typing) · disabled (sunken, ink-disabled) · error (danger-strong edge, aria-invalid)
 *   · success (success-strong edge) */

import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';

export interface InputProps extends ComponentProps<'input'> {
  /** Error: pair it with a message that says how to fix it. Success: e.g. a key that was checked. */
  status?: 'error' | 'success';
}

/** Text field. Uses raised surface and rule-strong border (3:1 on every surface) in both themes. */
export function Input({ className, status, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      data-status={status}
      aria-invalid={status === 'error' || undefined}
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-rule-strong bg-raised px-3 type-body text-ink shadow-xs',
        'transition-[border-color,background-color,box-shadow] duration-(--dur-micro) ease-(--ease-out)',
        'placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas',
        'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:text-ink-disabled disabled:shadow-none',
        'read-only:bg-sunken read-only:shadow-none',
        'aria-invalid:border-danger-strong data-[status=success]:border-success-strong',
        'file:border-0 file:bg-transparent file:font-medium file:text-ink',
        className,
      )}
      {...props}
    />
  );
}
