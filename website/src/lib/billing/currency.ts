// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { AUTO_CURRENCY, isCurrencyCode } from './api';

/**
 * The currency a visitor chose on /premium/ (US dollars or Indian rupees), kept for as long as the page stays open,
 * like the tag (ref.ts): in memory only, nothing in the browser's storage. Until someone chooses, the page asks the
 * billing service for `auto`, and the service picks from the country the request comes from.
 */

let chosen: string | null = null;

/** Keeps a choice the billing service has answered: the next quote of this visit asks in it. */
export function rememberCurrency(code: string): void {
  if (isCurrencyCode(code)) chosen = code;
}

/** What a quote is asked in: the visitor's choice, or `auto`. */
export function currencyToAsk(): string {
  return chosen ?? AUTO_CURRENCY;
}

/** For tests: a visit where nobody has chosen. */
export function forgetCurrency(): void {
  chosen = null;
}
