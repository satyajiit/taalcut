// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';
/* Hallmark · component: tooltip · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * the colour lane's `tooltip` plate (ink in light, a graphite plate above the overlay in dark, never a white flash),
 *   type-caption; fades in once the first wait is over and out faster. Opacity only,
 *   so reduced motion keeps the same 150 ms fade.
 * states: n/a (it names a control; the control carries the states) */

/**
 * Put one provider near the root of the app. The first tooltip waits most of
 * a second, so passing the pointer over the chrome shows nothing; once one is
 * open, its neighbours open at once (Radix's skip delay), as on macOS.
 */
export function TooltipProvider({
  delayDuration = 900,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/** The tooltip plate, so it reads over any surface in both themes. */
export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md border border-tooltip-rule bg-tooltip px-2 py-1 type-caption text-on-tooltip shadow-md',
          'data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
