// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: choice rows (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * a choice among a few that each need their words (a profile, a language, the update channel): one SettingRows
 *   frame of rows, each the kit's Radio with its words, so the whole row picks it (arrow keys move and choose, Radix).
 *   The chosen row takes the selected wash; whatever trails a row (a chip, a spinner) sits at its end.
 * states: default · hover (the row washes, the ring steps up) · focus (the radio's base ring, instant) · active (the
 *   ring gives by 8 %) · checked (the ink dot grows in, the row's selected wash) · disabled (ink-disabled, no wash) ·
 *   loading (aria-busy on the group, choices held) · error (danger rings, aria-invalid; the caller says why) ·
 *   success (the new choice is the answer)
 * reduced motion: the dot fades in whole
 *
 * RadioRow below is the old native-radio row, kept for the one caller outside Settings (projects' Apply a look);
 *   Settings' own choices are ChoiceRows. */
import { HOVER_EASE, Radio, RadioGroup, cn, type RadioGroupProps } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { SettingRows } from './rows';

/** The group and its frame: name it with aria-label (or a heading's id). */
export function ChoiceRows({ children, className, ...props }: RadioGroupProps) {
  return (
    <RadioGroup className={cn('gap-0', className)} {...props}>
      <SettingRows className="group-aria-busy/radios:cursor-progress">{children}</SettingRows>
    </RadioGroup>
  );
}

/** One choice: the kit's Radio and its words across the row, then what trails it; anything under it below. */
export function ChoiceRow({
  value,
  label,
  description,
  trailing,
  disabled = false,
  className,
  children,
}: {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  /** After it: a chip, a spinner. */
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Under the row, outside its hit area: a step the choice asks for (the beta terms). */
  children?: ReactNode;
}) {
  return (
    <li
      data-slot="choice-row"
      className={cn('flex flex-col border-t border-rule-subtle first:border-t-0', className)}
    >
      <div
        className={cn(
          'flex min-h-12 items-center gap-3 pe-3',
          HOVER_EASE,
          !disabled && 'hover:bg-hover has-[[data-state=checked]]:bg-selected',
        )}
      >
        <Radio
          value={value}
          label={label}
          disabled={disabled}
          className="flex min-w-0 flex-1 self-stretch py-2.5 ps-3"
          {...(description ? { description: <span className="block max-w-prose">{description}</span> } : {})}
        />
        {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
      </div>
      {children}
    </li>
  );
}

/** @deprecated The native-radio row, for Apply a look; Settings uses ChoiceRows. */
export function RadioRow({
  id,
  name,
  value,
  checked,
  disabled,
  onChoose,
  children,
  trailing,
  className,
  bodyClassName,
}: {
  id: string;
  /** The radio group's name. */
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChoose: () => void;
  /** What the row is. */
  children: ReactNode;
  /** After it: a chip, a spinner. */
  trailing?: ReactNode;
  /** The row's own extras (its edge, its disabled look). */
  className?: string;
  /** The body's own layout (a second line under the name). */
  bodyClassName?: string;
}) {
  return (
    <label
      htmlFor={id}
      data-checked={checked || undefined}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5',
        'transition-colors duration-(--dur-micro) ease-(--ease-out)',
        'hover:bg-hover active:bg-pressed data-checked:bg-selected',
        'has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-focus',
        className,
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChoose}
        className="size-4 shrink-0 cursor-pointer accent-primary-strong outline-none"
      />
      <span
        className={cn(
          'min-w-0 flex-1',
          bodyClassName,
          checked ? 'font-semibold text-ink' : 'font-medium text-ink-2',
        )}
      >
        {children}
      </span>
      {trailing}
    </label>
  );
}
