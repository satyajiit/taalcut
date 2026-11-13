// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: popover (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + the UX4 motion grammar
 * Radix Popover in tokens: a small panel of controls tied to its trigger (a scope picker, a gap's fix), on the
 *   overlay surface with a rule-subtle hairline, lg radius and the md shadow, the menus' surface. It pops from its
 *   trigger's side (scale 0.98 to 1 and a fade, --dur-short) and fades out faster; Escape and a click outside close
 *   it and focus goes back to the trigger (Radix). Never for something that needs a decision: that is a Dialog.
 * states: n/a for the panel (its controls carry theirs); the trigger is the caller's Button
 * reduced motion: the fades alone */
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';
import { POP_IN_OUT } from '#lib/motion-classes';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 flex w-72 max-w-(--radix-popover-content-available-width) flex-col gap-3 rounded-lg border border-rule-subtle bg-overlay p-3 text-ink shadow-md',
          'max-h-(--radix-popover-content-available-height) overflow-y-auto origin-(--radix-popover-content-transform-origin)',
          POP_IN_OUT,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
