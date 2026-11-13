// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: collapse (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: the UX4
 *   motion grammar (_orch/ux4/specs/design-kit.md)
 * expand and collapse without a jump: the box's height eases between nothing and its content (a grid row from 0fr
 *   to 1fr, --dur-short, --ease-in-out), so what is under it moves with it instead of jumping; the content fades with
 *   it. The grammar's one stated exception to "transform and opacity only": a disclosure has to move what follows.
 *   Closed, its content stays mounted (it keeps its state) but is inert and hidden from screen readers.
 * states: open · closed (n/a otherwise: the trigger is the caller's Button, with aria-expanded and aria-controls)
 * reduced motion: the height changes at once and the content fades over 150 ms (base.css) */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface CollapseProps extends Omit<ComponentProps<'div'>, 'children'> {
  open: boolean;
  children: ReactNode;
}

/** A region that opens and closes smoothly. Give it an `id` and point the trigger's aria-controls at it. */
export function Collapse({ open, className, children, ...props }: CollapseProps) {
  return (
    <div
      data-slot="collapse"
      data-state={open ? 'open' : 'closed'}
      inert={!open}
      aria-hidden={!open || undefined}
      className={cn(
        'grid overflow-hidden transition-[grid-template-rows,opacity] duration-(--dur-short) ease-(--ease-in-out)',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
      {...props}
    >
      <div className="relative min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
