// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: money-input · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * states: default (raised surface, rule-strong edge) · hover (edge ink-3) · focus (canvas surface, base ring, instant)
 *   · active (typing = focus) · disabled (sunken, ink-disabled) · loading (caller's button carries it) · error
 *   (danger edge, aria-invalid, caller's line under it) · success (saved amount shows)
 * The currency symbol sits where the language writes it (Intl), outside the text so it never gets typed over. */

import { useLingui } from '@lingui/react';
import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';
import { moneyShape } from '#lib/money';

export interface MoneyInputProps extends Omit<ComponentProps<'input'>, 'type' | 'inputMode'> {
  /** ISO 4217, e.g. 'USD'. */
  currency: string;
  invalid?: boolean;
}

/**
 * A field for an amount of money: the symbol fixed beside the digits, on the
 * side the user's language puts it, and the decimal keypad. The caller keeps
 * the text and parses it with parseMoneyText.
 */
export function MoneyInput({ currency, invalid = false, className, disabled, ...props }: MoneyInputProps) {
  const { i18n } = useLingui();
  const shape = moneyShape(i18n.locale, currency);
  const symbol = (
    <span aria-hidden className="type-meta font-medium text-ink-2 select-none" translate="no">
      {shape.symbol}
    </span>
  );
  return (
    <span
      data-slot="money-input"
      data-invalid={invalid || undefined}
      className={cn(
        'inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-rule-strong bg-raised px-3 shadow-xs',
        'transition-[border-color,background-color] duration-(--dur-micro) ease-(--ease-out)',
        'hover:border-ink-3 has-focus-visible:border-ink-2 has-focus-visible:bg-canvas',
        'data-invalid:border-danger-strong',
        disabled && 'cursor-not-allowed border-rule-subtle bg-sunken shadow-none hover:border-rule-subtle',
        className,
      )}
    >
      {shape.symbolFirst ? symbol : null}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="h-full w-full min-w-0 bg-transparent type-body font-medium text-ink tabular-nums outline-offset-4 placeholder:text-ink-3 disabled:cursor-not-allowed disabled:text-ink-disabled"
        {...props}
      />
      {shape.symbolFirst ? null : symbol}
    </span>
  );
}
