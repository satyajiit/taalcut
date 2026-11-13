// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: button · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + the UX4 motion grammar and icon registry · states: default · hover (colour eases,
 *   --dur-micro) · focus (base ring, instant) · active (gives by 2 %, the pressed surface) · disabled · loading (a
 *   spinner in the icon's place) · error · success (a tick in the icon's place, drawn in when the button comes
 *   straight from loading)
 * icon: the verb's glyph from the registry (`icon`), leading by default; 14 px on sm, 16 px otherwise
 * reduced motion: no give and no draw; colours and the tick's fade remain */

import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { PRESS_CONTROL } from '#lib/motion-classes';
import { renderIcon, type IconLike } from '../icons/glyph';
import { Tick } from './tick';

/**
 * Every control ships eight states (DESIGN.md, "How components sound"):
 * default, hover, focus, active, disabled, loading, error and success.
 * Focus comes from base.css (:focus-visible, instant, never animated).
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border',
    'select-none cursor-pointer',
    PRESS_CONTROL,
    'data-[state=loading]:cursor-progress data-[state=loading]:active:scale-100',
    'disabled:cursor-not-allowed disabled:active:scale-100 disabled:border-rule-subtle disabled:bg-sunken disabled:text-ink-disabled',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        // The one marigold fill on a screen. In light mode the fill gets a strong border.
        primary:
          'border-primary-strong bg-primary text-primary-ink hover:bg-primary-strong hover:text-primary-strong-ink',
        // A neutral filled face: the colour lane's `control` roles (a well in light, a step up in dark; UX4).
        secondary: 'border-rule bg-control text-ink hover:bg-control-hover active:bg-control-pressed',
        ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed',
        // Always say what it destroys: "Delete project", never "Delete".
        destructive:
          'border-danger-strong bg-danger text-danger-ink hover:bg-danger-strong hover:text-danger-strong-ink',
      },
      size: {
        // A full-size control's words are type-label; a small one's are type-label-sm, a step under (13 px). The
        // role sits on the size, so one button never carries both.
        sm: 'h-8 gap-1.5 px-3 type-label-sm [&_svg]:size-3.5',
        md: 'h-9 px-4 type-label',
        lg: 'h-10 px-5 type-label',
        icon: 'size-9 p-0 type-label',
      },
      // Error and success replace the variant's colours until the caller clears them.
      status: {
        none: '',
        error:
          'border-danger-strong bg-danger-soft text-danger-strong hover:bg-danger-soft hover:text-danger-strong',
        success:
          'border-success-strong bg-success-soft text-success-strong hover:bg-success-soft hover:text-success-strong',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md', status: 'none' },
  },
);

export type ButtonStatus = 'error' | 'success';

export interface ButtonProps
  extends ComponentProps<'button'>, Omit<VariantProps<typeof buttonVariants>, 'status'> {
  /**
   * Shows a spinner, marks the button busy and ignores clicks. It keeps its
   * colours and its focus (it is not `disabled`), so keyboard users don't lose
   * their place. Keep the label: "Exporting", not "".
   */
  loading?: boolean;
  /** Success puts a tick in the icon's place (drawn in when it comes straight from loading). */
  status?: ButtonStatus;
  /** The verb's glyph from the icon registry (`VERB_ICONS.retry`), or an element you sized yourself. */
  icon?: IconLike;
  /** Where the icon sits: before the words (the default) or after them (a "next" or a menu's chevron). */
  iconPlacement?: 'start' | 'end';
  /** Render the child element (e.g. a router Link) with button styling. */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  status,
  loading = false,
  icon,
  iconPlacement = 'start',
  asChild = false,
  disabled,
  onClick,
  children,
  ...props
}: ButtonProps) {
  // Was it loading on the render before? Then a success now is the work finishing: the tick draws itself in.
  const wasLoading = useRef(loading);
  const finished = status === 'success' && wasLoading.current;
  useEffect(() => {
    wasLoading.current = loading;
  }, [loading]);

  const state = loading ? 'loading' : (status ?? 'idle');
  const classes = cn(buttonVariants({ variant, size, status: status ?? 'none' }), className);
  const glyphSize = size === 'sm' ? 'sm' : 'md';
  const mark: ReactNode = loading ? (
    <LoaderCircle aria-hidden className="animate-spin" />
  ) : status === 'success' && (icon || finished) ? (
    <Tick draw={finished} data-slot="button-tick" />
  ) : (
    renderIcon(icon, glyphSize)
  );
  const start = iconPlacement === 'start' || loading ? mark : null;
  const end = iconPlacement === 'end' && !loading ? mark : null;
  if (asChild) {
    return (
      <Slot.Root data-slot="button" data-state={state} className={classes} onClick={onClick} {...props}>
        {start}
        <Slot.Slottable>{children}</Slot.Slottable>
        {end}
      </Slot.Root>
    );
  }
  return (
    <button
      type="button"
      data-slot="button"
      data-state={state}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...props}
    >
      {start}
      {children}
      {end}
    </button>
  );
}
