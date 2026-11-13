// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: switch · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * states: default (off: sunken track, rule-strong edge, the `thumb` knob (UX4 colour roles); on: marigold primary
 *   track, canvas thumb with a tick that draws itself in) · hover (track shifts one step: off to the hover surface,
 *   on to primary-strong; also while its label is pointed at) · focus (base ring, instant) · active (the thumb
 *   presses wider) · disabled (aria-disabled, ink-disabled, not-allowed) · loading (aria-busy, spinner in thumb,
 *   clicks ignored, focus kept) · error (danger edge, aria-invalid) · success (settled: the new state is the answer)
 * UX4: with `label` the words (and their line) are part of the hit area, as on macOS: clicking them flips it.
 * motion: the thumb slides on transform (--dur-short, --ease-out) and its tick draws in; reduced motion: the thumb
 *   moves at once and the tick fades in (base.css) */
import { LoaderCircle } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { HOVER_EASE } from '#lib/motion-classes';
import { Tick } from './tick';

export interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'value'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Busy: the change is on its way. Keeps focus and colours; clicks are ignored. */
  loading?: boolean;
  /** The last change failed: the switch is back where it was and the caller says why under it. */
  invalid?: boolean;
  /**
   * What it turns on, beside it and part of its hit area (the switch sits at the row's end). Leave it out and name
   * the switch with aria-label or aria-labelledby instead.
   */
  label?: ReactNode;
  /** One line under the label: what changes. It describes the switch. */
  description?: ReactNode;
}

/**
 * An on/off setting that applies at once (DESIGN.md: a person's switch).
 * A real button with role="switch", so keyboards (Space, Return) and screen
 * readers work as on macOS. High-contrast marigold track + tick when on
 * so on/off state is unmistakable in both light and dark modes.
 */
export function Switch({
  checked,
  onCheckedChange,
  loading = false,
  invalid = false,
  disabled,
  className,
  onClick,
  label,
  description,
  id,
  ...props
}: SwitchProps) {
  const made = useId();
  const switchId = id ?? made;
  const labelId = `${switchId}-label`;
  const descriptionId = `${switchId}-description`;
  const control = (
    <button
      type="button"
      role="switch"
      id={switchId}
      data-slot="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-invalid={invalid || undefined}
      aria-disabled={disabled || undefined}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      data-state={loading ? 'loading' : checked ? 'on' : 'off'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled || loading) return;
        onCheckedChange(!checked);
      }}
      className={cn(
        'group/switch relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border p-0.5 shadow-xs',
        HOVER_EASE,
        checked
          ? 'border-primary-strong bg-primary hover:bg-primary-strong group-hover/field:bg-primary-strong'
          : 'border-rule-strong bg-sunken hover:border-ink-3 hover:bg-hover group-hover/field:border-ink-3 group-hover/field:bg-hover',
        'aria-invalid:border-danger-strong',
        'aria-busy:cursor-progress',
        'aria-disabled:cursor-not-allowed aria-disabled:border-rule aria-disabled:bg-sunken aria-disabled:shadow-none',
        label ? 'mt-0.5' : className,
      )}
      {...props}
    >
      <span
        aria-hidden
        data-slot="switch-thumb"
        className={cn(
          'flex size-[1.125rem] items-center justify-center rounded-pill shadow-sm',
          'transition-transform duration-(--dur-short) ease-(--ease-out) group-active/switch:scale-x-110',
          checked
            ? 'translate-x-5 bg-canvas text-primary-strong'
            : // The off knob is the colour lane's `thumb` role: raised in light, a grey that reads on the dark track.
              'translate-x-0 bg-thumb text-on-thumb',
          // Disabled: a quiet knob that still shows where it rests, in both themes.
          'group-aria-disabled/switch:bg-rule group-aria-disabled/switch:text-ink-disabled group-aria-disabled/switch:shadow-none',
        )}
      >
        {loading ? (
          // 10 px, so it fits the knob at any angle of its turn (a turning square is √2 wider).
          <LoaderCircle className="size-2.5 animate-spin text-ink-2" />
        ) : checked ? (
          <Tick size={12} strokeWidth={2.75} />
        ) : null}
      </span>
    </button>
  );
  if (!label) return control;
  return (
    <label
      htmlFor={switchId}
      data-slot="switch-field"
      className={cn(
        'group/field flex min-w-0 cursor-pointer items-start justify-between gap-x-6',
        disabled && 'cursor-not-allowed',
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className={cn('type-label text-ink', disabled && 'text-ink-disabled')}>
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="max-w-prose type-meta text-ink-2">
            {description}
          </span>
        ) : null}
      </span>
      {control}
    </label>
  );
}
