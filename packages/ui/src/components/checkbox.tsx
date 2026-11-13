// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: checkbox (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + the UX4 motion grammar
 * Radix Checkbox: a 16 px box (a 24 px hit area) that fills with the `inverse` ink when ticked, never marigold, so the screen's
 *   one marigold fill stays its primary (DESIGN.md, Bulk selection); the tick draws itself in (Tick). With `label`
 *   the words are part of the hit area: clicking them ticks the box, as on macOS.
 * states: default (raised, rule-strong edge) · hover (edge ink-3; also when the label is pointed at) · focus (base
 *   ring, instant) · active (gives by 8 %) · checked (ink fill, canvas tick) · indeterminate (ink fill, a dash) ·
 *   disabled (sunken, rule-subtle, ink-disabled) · loading (aria-busy, a spinner, clicks ignored) · error
 *   (danger-strong edge, aria-invalid; the caller says why) · success: n/a (the tick is the answer)
 * contrast: rule-strong edge ≥ 3:1 on canvas, raised and sunken; canvas on ink ≥ 7:1 in both themes
 * reduced motion: the tick is whole and fades in; the box doesn't give */
import { LoaderCircle, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { Tick } from './tick';

export type CheckedState = boolean | 'indeterminate';

export interface CheckboxProps extends Omit<
  ComponentProps<typeof CheckboxPrimitive.Root>,
  'checked' | 'onCheckedChange'
> {
  checked: CheckedState;
  onCheckedChange: (checked: boolean) => void;
  /** Words beside the box, part of its hit area. Leave out and name it with aria-label(ledby) instead. */
  label?: ReactNode;
  /** A line under the label, read as the box's description. */
  description?: ReactNode;
  /** The change is on its way: a spinner, clicks ignored, focus kept. */
  loading?: boolean;
  /** The last change failed; the caller says why near it. */
  invalid?: boolean;
}

/**
 * The target. A bare box is a 24 px button (WCAG 2.5.8) with the 16 px face in its middle, so nothing hangs
 * outside it; with words, the label is the target and the button is the face's own size. The face draws the box
 * from the target's state.
 */
const TARGET = cn(
  'peer group/box relative inline-flex shrink-0 cursor-pointer items-center justify-center',
  'aria-busy:cursor-progress disabled:cursor-not-allowed',
);
const BARE = 'size-6 rounded-md focus-visible:outline-offset-0';
const WORDED = 'mt-0.5 size-4 rounded-clip';

/** The 16 px face. */
const FACE = cn(
  'flex size-4 items-center justify-center rounded-clip border border-rule-strong bg-raised text-on-inverse shadow-xs',
  'transition-[background-color,border-color,scale] duration-(--dur-micro) ease-(--ease-out)',
  'group-hover/box:border-ink-3 group-hover/check:border-ink-3',
  'group-active/box:scale-[0.92] motion-reduce:group-active/box:scale-100',
  'group-data-[state=checked]/box:border-inverse group-data-[state=checked]/box:bg-inverse',
  'group-data-[state=indeterminate]/box:border-inverse group-data-[state=indeterminate]/box:bg-inverse',
  'group-aria-invalid/box:border-danger-strong',
  'group-disabled/box:border-rule-subtle group-disabled/box:bg-sunken group-disabled/box:shadow-none group-disabled/box:scale-100',
  'group-disabled/box:group-data-[state=checked]/box:border-ink-disabled group-disabled/box:group-data-[state=checked]/box:bg-ink-disabled',
);

/** A yes-or-no choice that is part of a form or a selection (a setting that applies at once is a Switch). */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  loading = false,
  invalid = false,
  disabled,
  className,
  id,
  ...props
}: CheckboxProps) {
  // Named by its words alone, described by its line (the label element would read both as the name).
  const words = useId();
  const line = useId();
  const box = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      id={id}
      checked={checked}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-invalid={invalid || undefined}
      aria-labelledby={label ? words : undefined}
      aria-describedby={description ? line : undefined}
      onCheckedChange={(next) => {
        if (!loading) onCheckedChange(next === true);
      }}
      className={cn(TARGET, label ? WORDED : cn(BARE, className))}
      {...props}
    >
      <span data-slot="checkbox-face" aria-hidden className={FACE}>
        {loading ? (
          // 10 px, so it fits the box at any angle of its turn (a turning square is √2 wider).
          <LoaderCircle className="size-2.5 animate-spin text-ink-2" />
        ) : (
          <CheckboxPrimitive.Indicator className="flex items-center justify-center">
            {checked === 'indeterminate' ? (
              <Minus className="size-3" strokeWidth={3} />
            ) : (
              <Tick size={12} strokeWidth={3} />
            )}
          </CheckboxPrimitive.Indicator>
        )}
      </span>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <label
      data-slot="checkbox-field"
      className={cn(
        'group/check inline-flex max-w-full cursor-pointer items-start gap-2',
        disabled && 'cursor-not-allowed',
        className,
      )}
    >
      {box}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={words} className={cn('type-body text-ink', disabled && 'text-ink-disabled')}>
          {label}
        </span>
        {description ? (
          <span id={line} className="type-meta text-ink-2">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
