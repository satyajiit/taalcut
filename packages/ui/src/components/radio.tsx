// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: radio (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + the UX4 motion grammar
 * Radix RadioGroup: one of a few choices that need their words (a short set of words is Segmented). A 16 px ring
 *   whose ink dot grows in from the middle when chosen; the ring and its words make one hit area (a Radio always
 *   has words, so the target is never the bare ring). Arrow keys move and choose (Radix).
 * states: default (raised, rule-strong ring) · hover (ring ink-3, also over the words) · focus (base ring, instant)
 *   · active (gives by 8 %) · checked (ink ring and dot) · disabled (sunken, rule-subtle, ink-disabled) · loading
 *   (aria-busy on the group, choices held, focus kept) · error (danger-strong rings, aria-invalid on the group) · success: n/a
 * reduced motion: the dot fades in, already whole */
import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface RadioGroupProps extends ComponentProps<typeof RadioPrimitive.Root> {
  /** The choice is on its way: choices held, the group marked busy. */
  loading?: boolean;
  /** The last choice failed; the caller says why under the group. */
  invalid?: boolean;
}

/** The group: name it with aria-label or aria-labelledby (a heading or a field's label). */
export function RadioGroup({
  loading = false,
  invalid = false,
  className,
  onValueChange,
  ...props
}: RadioGroupProps) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group"
      aria-busy={loading || undefined}
      aria-invalid={invalid || undefined}
      // Held while a choice saves, not disabled: disabling the focused choice would drop focus to the page. The
      // arrow keys still move; a choice made meanwhile is let go (a controlled group keeps the one saving).
      onValueChange={loading ? undefined : onValueChange}
      className={cn('group/radios flex flex-col gap-3', className)}
      {...props}
    />
  );
}

export interface RadioProps extends ComponentProps<typeof RadioPrimitive.Item> {
  /** The choice's words, part of its hit area. */
  label: ReactNode;
  /** A line under the words. */
  description?: ReactNode;
}

/** One choice in a RadioGroup. */
export function Radio({ label, description, className, disabled, ...props }: RadioProps) {
  // Named by its words alone, described by its line (the label element would read both as the name).
  const words = useId();
  const line = useId();
  return (
    <label
      data-slot="radio"
      className={cn(
        'group/radio inline-flex max-w-full cursor-pointer items-start gap-2',
        disabled && 'cursor-not-allowed',
        className,
      )}
    >
      <RadioPrimitive.Item
        disabled={disabled}
        aria-labelledby={words}
        aria-describedby={description ? line : undefined}
        className={cn(
          'relative mt-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-pill border',
          'border-rule-strong bg-raised shadow-xs',
          'transition-[border-color,scale] duration-(--dur-micro) ease-(--ease-out)',
          'hover:border-ink-3 group-hover/radio:border-ink-3 active:scale-[0.92] motion-reduce:active:scale-100',
          'data-[state=checked]:border-inverse',
          'group-aria-invalid/radios:border-danger-strong',
          'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:shadow-none disabled:active:scale-100',
        )}
        {...props}
      >
        <RadioPrimitive.Indicator
          className={cn(
            'size-2 rounded-pill bg-inverse data-disabled:bg-ink-disabled',
            'transition-[scale,opacity] duration-(--dur-short) ease-(--ease-out) starting:scale-0 starting:opacity-0',
          )}
        />
      </RadioPrimitive.Item>
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
