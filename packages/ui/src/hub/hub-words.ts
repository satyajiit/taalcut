// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Words the hub rows, the results card and the Share view share: a language's name and a rating (U3, U4). */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { HubRating } from '@taalcut/core';

/** Ratings under this many show "New" instead of a mean (docs/template-hub.md section 6). */
export const NEW_UNDER_RATINGS = 3;

/** The pseudo-locale names things as English does. */
const intlLocale = (locale: string) => (locale === 'en-XA' ? 'en' : locale);

/** The languages hub templates are mostly in, named through the catalogue (as the renderer's formatLanguage does). */
const LANGUAGE_NAMES: Readonly<Record<string, MessageDescriptor>> = {
  en: msg`English`,
  es: msg`Spanish`,
  hi: msg`Hindi`,
  'pt-BR': msg`Brazilian Portuguese`,
};

/** "Hindi" for hi, in the app's language; others through Intl; the tag itself when Intl can't name it. */
export function languageName(i18n: I18n, tag: string): string {
  const known = LANGUAGE_NAMES[tag];
  if (known) return i18n._(known);
  try {
    return new Intl.DisplayNames([intlLocale(i18n.locale)], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function isNewRating(rating: HubRating | null): boolean {
  return rating === null || rating.count < NEW_UNDER_RATINGS;
}

/** "Rated 4.6 out of 5 by 38 people", or "New: fewer than 3 ratings", for a screen reader. */
export function ratingLabel(i18n: I18n, rating: HubRating | null): string {
  if (rating === null || isNewRating(rating)) return i18n._(msg`New: fewer than 3 ratings`);
  const mean = i18n.number(rating.mean, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const count = i18n.number(rating.count);
  return i18n._(msg`Rated ${mean} out of 5 by ${count} people`);
}

const HOUR_MS = 3_600_000;

/**
 * "3 hours ago" for an index older than an hour (the list then says "As of 3 hours ago"); null when it is fresh.
 * Whole hours, then whole days, through Intl.
 */
export function indexAge(i18n: I18n, fetchedAt: number, now: number): string | null {
  const age = now - fetchedAt;
  if (age < HOUR_MS) return null;
  const relative = new Intl.RelativeTimeFormat(intlLocale(i18n.locale), { numeric: 'auto' });
  const hours = Math.floor(age / HOUR_MS);
  return hours < 48 ? relative.format(-hours, 'hour') : relative.format(-Math.floor(hours / 24), 'day');
}

/** "in 12 minutes", "in 2 hours": when a rate-limited share may go again, as Intl writes it mid-sentence. */
export function retryIn(i18n: I18n, seconds: number): string {
  const relative = new Intl.RelativeTimeFormat(intlLocale(i18n.locale), { numeric: 'always' });
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes < 60
    ? relative.format(minutes, 'minute')
    : relative.format(Math.round(minutes / 60), 'hour');
}
