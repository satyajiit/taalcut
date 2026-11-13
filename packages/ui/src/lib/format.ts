// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { useLingui } from '@lingui/react';
import type { Money } from '@taalcut/core';
import { useMemo } from 'react';

/** Locales the app shows that Intl doesn't know: the pseudo-locale formats like English. */
const INTL_LOCALE: Readonly<Record<string, string>> = { 'en-XA': 'en' };

export interface Formatters {
  /** 4.2s, 3m 12s, 1h 5m. Narrow units, so they read in every language. */
  duration(ms: number): string;
  /**
   * $0.42 from micro-units, with the currency's own symbol as Usage writes it: "US$" in Spanish and Portuguese
   * ("$" alone is the peso there, and Brazil's real is "R$"), "$" in English and Hindi.
   */
  money(amount: Money): string;
  /** 12,400 */
  count(value: number): string;
  /** 40% from 0.4 */
  percent(fraction: number): string;
  /**
   * A date and time with the month in words, e.g. "Oct 11, 2026, 3:04 PM" ("11 oct 2026, 15:04"): an all-numbers
   * date reads as unfinished and means different days in different languages (audit L10). Shown in a <time>.
   */
  dateTime(epochMs: number): string;
  /**
   * When, the way a list of chats says it: the time today, "Yesterday", the
   * weekday within the week, then the date (with the year when it isn't this
   * year). `now` is for tests.
   */
  relativeDay(epochMs: number, now?: number): string;
  /** The time of day, short: 3:40 pm, 15:40. */
  time(epochMs: number): string;
  /**
   * How long until a moment, as a sentence starts it: "In 12 minutes", "In 2 hours" (minutes under an hour, then
   * whole hours). `remainingMs` at or under 0 is "In 0 minutes"; callers say "any moment" themselves.
   */
  untilFromNow(remainingMs: number): string;
}

const DAY_MS = 86_400_000;

/** Midnight before `epochMs`, in local time. */
function startOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function createFormatters(locale: string): Formatters {
  const intl = INTL_LOCALE[locale] ?? locale;
  const unit = (name: string, digits = 0) =>
    new Intl.NumberFormat(intl, {
      style: 'unit',
      unit: name,
      unitDisplay: 'narrow',
      maximumFractionDigits: digits,
    });
  const seconds = unit('second', 1);
  const wholeSeconds = unit('second');
  const minutes = unit('minute');
  const hours = unit('hour');
  const count = new Intl.NumberFormat(intl);
  const percent = new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 0 });
  const dateTime = new Intl.DateTimeFormat(intl, { dateStyle: 'medium', timeStyle: 'short' });
  const time = new Intl.DateTimeFormat(intl, { timeStyle: 'short' });
  const weekday = new Intl.DateTimeFormat(intl, { weekday: 'long' });
  const dayMonth = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short' });
  const fullDate = new Intl.DateTimeFormat(intl, { dateStyle: 'medium' });
  const relative = new Intl.RelativeTimeFormat(intl, { numeric: 'auto' });
  // "yesterday" starts a line here: capitalise its first letter the language's way.
  const capitalised = (text: string) => text.charAt(0).toLocaleUpperCase(intl) + text.slice(1);
  return {
    duration(ms) {
      const total = Math.max(0, ms) / 1000;
      if (total < 60) return seconds.format(Math.round(total * 10) / 10);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = Math.floor(total % 60);
      if (h > 0) return `${hours.format(h)} ${minutes.format(m)}`;
      return s > 0 ? `${minutes.format(m)} ${wholeSeconds.format(s)}` : minutes.format(m);
    },
    money: ({ currency, micros }) =>
      new Intl.NumberFormat(intl, {
        style: 'currency',
        currency,
        maximumFractionDigits: Math.abs(micros) < 10_000_000 ? 3 : 2,
      }).format(micros / 1_000_000),
    count: (value) => count.format(value),
    percent: (fraction) => percent.format(fraction),
    dateTime: (epochMs) => dateTime.format(epochMs),
    relativeDay(epochMs, now = Date.now()) {
      const days = Math.round((startOfDay(now) - startOfDay(epochMs)) / DAY_MS);
      if (days <= 0) return time.format(epochMs);
      if (days === 1) return capitalised(relative.format(-1, 'day'));
      if (days < 7) return weekday.format(epochMs);
      const sameYear = new Date(epochMs).getFullYear() === new Date(now).getFullYear();
      return (sameYear ? dayMonth : fullDate).format(epochMs);
    },
    time: (epochMs) => time.format(epochMs),
    untilFromNow(remainingMs) {
      const minutes = Math.max(0, Math.ceil(remainingMs / 60_000));
      const ahead = new Intl.RelativeTimeFormat(intl, { numeric: 'always' });
      return capitalised(
        minutes < 60 ? ahead.format(minutes, 'minute') : ahead.format(Math.round(minutes / 60), 'hour'),
      );
    },
  };
}

/** The pseudo-locale: Lingui's accented English, which has no list words of its own. */
const PSEUDO_LOCALE = 'en-XA';

/**
 * Items joined the active language's way, "and" included: "Agent, Seeing your clips, and Voice-over", "Agente, Ver
 * tus clips y Voz en off", "एजेंट, आपकी क्लिप देखना और वॉइस-ओवर" (Intl.ListFormat, a conjunction, in the active Lingui
 * locale). The pseudo-locale gets Intl's unit list ("a, b, c"), so no English "and" shows through it.
 */
export function listOf(i18n: Pick<I18n, 'locale'>, items: readonly string[]): string {
  const format =
    i18n.locale === PSEUDO_LOCALE
      ? new Intl.ListFormat(INTL_LOCALE[PSEUDO_LOCALE], { type: 'unit', style: 'short' })
      : new Intl.ListFormat(i18n.locale, { type: 'conjunction' });
  return format.format(items);
}

/** Intl formatters for the active language. */
export function useFormatters(): Formatters {
  const { i18n } = useLingui();
  const locale = i18n.locale;
  return useMemo(() => createFormatters(locale), [locale]);
}
