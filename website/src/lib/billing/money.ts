// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the Premium pages write an amount, a day and a wait. Everything goes through `Intl`; nothing here decides a
 * price, it only writes the one the billing service quoted. The words are English, like the site; a moment is said in
 * the visitor's own time zone, with the zone named.
 */

/** How many minor units make one unit of a currency (100 cents to the dollar), from the currency's own digits. */
function minorUnits(currency: string): number {
  const digits =
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ??
    2;
  return 10 ** digits;
}

/** An amount in minor units as money: 33900 US cents is "$339", 33950 is "$339.50". */
export function money(amountMinor: number, currency: string): string {
  const units = minorUnits(currency);
  const whole = amountMinor % units === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format(amountMinor / units);
}

/** A day: "21 November 2026", in the visitor's time zone (or `timeZone`, for a test). */
export function dayWords(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

/** A moment: "26 November at 13:31 IST", so an offer that ends at midnight somewhere else isn't read as a whole day. */
export function momentWords(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** A wait: "45 seconds", "2 minutes", "1 hour", rounded up. */
export function waitWords(seconds: number): string {
  const [value, unit] =
    seconds < 90
      ? [Math.max(1, Math.ceil(seconds)), 'second']
      : seconds < 5400
        ? [Math.ceil(seconds / 60), 'minute']
        : [Math.ceil(seconds / 3600), 'hour'];
  return new Intl.NumberFormat('en-US', { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}
