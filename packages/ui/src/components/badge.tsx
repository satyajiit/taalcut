// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';
/* Hallmark · component: badge and chip · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (type-caption, 14 px glyphs from the icon registry)
 * states: n/a (labels, not controls; a chip that acts is a Button) */

/**
 * Soft wash plus strong text (DESIGN.md, "Chips"). Tones are meanings, not
 * colours: `ai` is what the agent decided, `you` is what the user changed.
 * Always pair a tone with a word or icon so it survives greyscale.
 */
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 type-caption font-semibold whitespace-nowrap [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-chip text-ink-2',
        primary: 'bg-primary-soft text-primary-strong',
        ai: 'bg-ai-soft text-ai-strong',
        you: 'bg-you-soft text-you-strong',
        beat: 'bg-beat-soft text-beat-strong',
        success: 'bg-success-soft text-success-strong',
        warning: 'bg-warning-soft text-warning-strong',
        danger: 'bg-danger-soft text-danger-strong',
        info: 'bg-info-soft text-info-strong',
      },
      shape: {
        // Badges: compact labels (timeline, counts). Chips: pill, 12 px semibold.
        badge: 'rounded-sm px-1.5 py-px [&_svg]:size-3',
        chip: 'rounded-pill px-2 py-0.5 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { tone: 'neutral', shape: 'badge' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, shape, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone, shape }), className)} {...props} />;
}

export function Chip({ className, tone, ...props }: Omit<BadgeProps, 'shape'>) {
  return (
    <span data-slot="chip" className={cn(badgeVariants({ tone, shape: 'chip' }), className)} {...props} />
  );
}
