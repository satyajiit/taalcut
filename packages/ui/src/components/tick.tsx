// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: tick (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 +
 *   the UX4 motion grammar (_orch/ux4/specs/design-kit.md)
 * Lucide's check, drawn: when it appears it strokes itself in from its short end over --dur-short, --ease-out
 *   (@starting-style, so no script runs). The one paint property the kit animates (stroke-dashoffset), on a glyph
 *   of 16 px or less; it moves nothing around it. Used by Checkbox, Switch and a Button's success.
 * reduced motion: base.css lets only opacity ease, so the tick fades in over 150 ms, already whole
 * states: n/a (a mark, not a control) */
import type { SVGProps } from 'react';
import { cn } from '#lib/cn';

export interface TickProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Draw it in when it appears. Off: it is simply there (a box that was already ticked when the page opened). */
  draw?: boolean;
  /** px; follows the text around it when left out. */
  size?: number;
}

/** A check mark that can draw itself in. Decorative: the control or the words around it say what it means. */
export function Tick({ draw = true, size, className, strokeWidth = 2, ...props }: TickProps) {
  return (
    <svg
      aria-hidden
      data-slot="tick"
      data-draw={draw || undefined}
      viewBox="0 0 24 24"
      width={size ?? '1em'}
      height={size ?? '1em'}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      {...props}
    >
      <path
        d="m4 12 5 5L20 6"
        pathLength={1}
        className={cn(
          '[stroke-dasharray:1] [stroke-dashoffset:0]',
          draw &&
            'transition-[stroke-dashoffset,opacity] duration-(--dur-short) ease-(--ease-out) starting:opacity-0 starting:[stroke-dashoffset:1]',
        )}
      />
    </svg>
  );
}
