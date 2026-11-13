// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';

/* Hallmark · component: card · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * a raised surface for what asks you to decide (DESIGN.md, Decision cards) or a plate that isn't one (UX3). Title
 *   type-card-title, description type-meta. Never a card inside a card.
 * states: n/a (a surface; its controls carry theirs) */

/** A raised surface: lighter than the canvas in light mode, a step up in dark mode. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-rule-subtle bg-raised p-5 text-ink shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" className={cn('m-0 type-card-title text-ink', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('m-0 type-meta text-ink-2', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('type-body', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="card-footer" className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
  );
}
