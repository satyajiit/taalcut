// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap fix popover (P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · "Fix this gap" on the editor's bed: the gap's fixes in a popover on the popover surface
 *   (hairline, lg radius), anchored to the gap block (an option of the bed's listbox, so it is an anchor, not a
 *   trigger: an option can't carry aria-expanded); focus moves in on open and back to the block on close
 * states: closed · open (instantly: DESIGN.md popovers don't animate in) · its contents' states (GapFixView)
 * keyboard: the block opens it (Return or Space, the caller's); Escape and a click outside close it
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface GapFixPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What it is anchored to (asChild): the gap block, which opens it itself. */
  anchor: ReactNode;
  /** Closed: focus goes back here (the gap block). */
  onClosed?: () => void;
  /** A press on the anchor isn't "outside": the anchor toggles the popover itself. */
  isAnchor?: (target: EventTarget | null) => boolean;
  /** The popover's accessible name: "Fix shot 3". */
  label: string;
  children: ReactNode;
  className?: string;
}

export function GapFixPopover({
  open,
  onOpenChange,
  anchor,
  onClosed,
  isAnchor,
  label,
  children,
  className,
}: GapFixPopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor asChild>{anchor}</PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="gap-fix-popover"
          aria-label={label}
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onInteractOutside={(event) => {
            if (isAnchor?.(event.target)) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed?.();
          }}
          className={cn(
            'z-50 flex max-h-(--radix-popover-content-available-height) w-[30rem] max-w-[calc(100vw-24px)] flex-col',
            'overflow-y-auto rounded-lg border border-rule-subtle bg-popover p-4 text-popover-foreground shadow-md',
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
