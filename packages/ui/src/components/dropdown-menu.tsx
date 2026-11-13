// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: dropdown menu · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6
 *   + the UX4 motion grammar
 * Radix DropdownMenu on the overlay surface: it pops from its trigger's side (scale 0.98 to 1 and a fade) and fades
 *   out faster; the highlight eases onto an item (--dur-micro) as the pointer or the arrows reach it. Items are
 *   type-label, a verb's glyph from the icon registry before the words, a shortcut after them.
 * states (an item): default · hover / keyboard highlight (the hover surface, eased) · focus (the highlight; the
 *   menu holds focus) · active (the pressed surface) · disabled (ink-disabled, skipped) · destructive (danger-strong
 *   on danger-soft) · loading, error, success: n/a (the command it runs says them)
 * reduced motion: the fades alone */

import { Circle } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';
import { HOVER_EASE, POP_IN_OUT } from '#lib/motion-classes';
import { Tick } from './tick';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

// The hover surface, not `bg-accent` (which means marigold in one token file and this grey in another: B22).
const itemClassName = cn(
  'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 type-label text-ink outline-none select-none',
  HOVER_EASE,
  'data-highlighted:bg-hover active:bg-pressed',
  'data-[disabled]:pointer-events-none data-[disabled]:text-ink-disabled',
  '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
);

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-40 overflow-x-hidden overflow-y-auto rounded-lg border border-rule-subtle bg-overlay p-1',
          'text-ink shadow-md max-h-(--radix-dropdown-menu-content-available-height)',
          'origin-(--radix-dropdown-menu-content-transform-origin)',
          POP_IN_OUT,
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { variant?: 'default' | 'destructive' }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        itemClassName,
        'data-[variant=destructive]:text-danger-strong data-[variant=destructive]:data-highlighted:bg-danger-soft',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClassName, 'pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Tick />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClassName, 'pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Circle aria-hidden className="size-2 fill-current" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2 py-1.5 type-caption text-ink-3', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-rule-subtle', className)}
      {...props}
    />
  );
}

/** Keyboard shortcut hint, e.g. ⌘K. */
export function DropdownMenuShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto pl-4 type-caption tracking-wide text-ink-3', className)}
      {...props}
    />
  );
}
