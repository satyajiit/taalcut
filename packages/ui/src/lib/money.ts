// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Money } from '@taalcut/core';

/** Locales the app shows that Intl doesn't know: the pseudo-locale formats like English. */
const INTL_LOCALE: Readonly<Record<string, string>> = { 'en-XA': 'en' };

export const MICROS = 1_000_000;

export function intlLocale(locale: string): string {
  return INTL_LOCALE[locale] ?? locale;
}

/** How a currency amount is written in a locale: the symbol and where it goes, and the decimal mark. */
export interface MoneyShape {
  readonly symbol: string;
  readonly symbolFirst: boolean;
  readonly decimal: string;
  readonly group: string;
  readonly fractionDigits: number;
}

export function moneyShape(locale: string, currency: string): MoneyShape {
  // The symbol money is shown with everywhere (format.ts): "US$" in Spanish and Portuguese, "$" in English.
  const parts = new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).formatToParts(
    12345.6,
  );
  const kinds = parts.map((part) => part.type);
  const options = new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
  }).resolvedOptions();
  return {
    symbol: parts.find((part) => part.type === 'currency')?.value ?? currency,
    symbolFirst: kinds.indexOf('currency') < kinds.indexOf('integer'),
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    fractionDigits: options.maximumFractionDigits ?? 2,
  };
}

/** An amount as the field shows it: digits only, the locale's decimal mark, no symbol ("2.50", "2,50"). */
export function moneyFieldText(amount: Money, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(amount.micros / MICROS);
}

/**
 * What someone typed in a money field, in micros, or null when it isn't an
 * amount. Takes the locale's decimal mark (and a dot, which every keyboard
 * has), ignores the symbol, spaces and the grouping mark; at most two decimals.
 */
export function parseMoneyText(text: string, locale: string, currency: string): number | null {
  const shape = moneyShape(locale, currency);
  // A bare "$" typed where the field shows "US$" is the same dollar: any currency sign goes too.
  let cleaned = text.replaceAll(shape.symbol, '').replace(/\p{Sc}|\s/gu, '');
  if (shape.group !== shape.decimal && shape.group !== '.') cleaned = cleaned.replaceAll(shape.group, '');
  if (shape.decimal !== '.') cleaned = cleaned.replace(shape.decimal, '.');
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100) * (MICROS / 100);
}
