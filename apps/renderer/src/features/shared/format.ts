// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Numbers, money, durations, sizes and dates through Intl, in the active
 * locale (AGENTS.md rule 6). Lingui's i18n.number and i18n.date are Intl with
 * the current locale; the pseudo-locale falls back to English formats.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export function formatCount(i18n: I18n, value: number): string {
  return i18n.number(value);
}

/** 1.2K, 3.4M: for totals that only need a rough size. */
export function formatCompact(i18n: I18n, value: number): string {
  return i18n.number(value, { notation: 'compact', maximumFractionDigits: 1 });
}

/**
 * Model costs are often fractions of a cent. Below a cent show two
 * significant digits (US$0.000024); above it, up to four decimals.
 */
export function formatUsd(i18n: I18n, value: number): string {
  const base = { style: 'currency', currency: 'USD' } as const;
  if (value > 0 && value < 0.01) return i18n.number(value, { ...base, maximumSignificantDigits: 2 });
  return i18n.number(value, { ...base, minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** 41 ms, 3.4 sec, 2.1 min, in the locale's own unit words. */
export function formatDuration(i18n: I18n, ms: number): string {
  const unit = (value: number, name: 'millisecond' | 'second' | 'minute' | 'hour', digits: number) =>
    i18n.number(value, { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: digits });
  if (ms < 1000) return unit(Math.round(ms), 'millisecond', 0);
  if (ms < 60_000) return unit(ms / 1000, 'second', 1);
  if (ms < 3_600_000) return unit(ms / 60_000, 'minute', 1);
  return unit(ms / 3_600_000, 'hour', 1);
}

/** Sizes in the units people see in Finder (powers of 1000). */
export function formatBytes(i18n: I18n, bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  return i18n.number(value, {
    style: 'unit',
    unit: units[index],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 && index > 0 ? 1 : 0,
  });
}

/** Memory the way Apple sells it: 16 GB means 16 GiB. */
export function formatMemory(i18n: I18n, bytes: number): string {
  return i18n.number(bytes / 1024 ** 3, {
    style: 'unit',
    unit: 'gigabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  });
}

export function formatDateTime(i18n: I18n, epochMs: number): string {
  return i18n.date(new Date(epochMs), { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(i18n: I18n, epochMs: number): string {
  return i18n.date(new Date(epochMs), { timeStyle: 'medium' });
}

/** An ISO date ('2026-10-23') as a calendar date, without a time-zone shift. */
export function formatIsoDate(i18n: I18n, isoDate: string): string {
  // A date-only ISO string parses as UTC midnight.
  return i18n.date(new Date(isoDate), { dateStyle: 'long', timeZone: 'UTC' });
}

export function formatPercent(i18n: I18n, fraction: number): string {
  return i18n.number(fraction, { style: 'percent', maximumFractionDigits: 0 });
}

type Parts = { hours?: number; minutes: number; seconds: number };
/** Intl.DurationFormat (ES2025; this repository's TypeScript lib stops at ES2024). */
type DurationFormat = new (
  locale: string,
  options: { hours?: 'numeric'; minutes: 'numeric' | '2-digit'; seconds: '2-digit' },
) => { format(duration: Parts): string };

/** Whole seconds as a player shows them (0:12, 1:04:09), through Intl.DurationFormat. */
export function formatClipLength(i18n: I18n, seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const parts = {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
  try {
    const Format = (Intl as unknown as { DurationFormat: DurationFormat }).DurationFormat;
    // The first unit unpadded, the rest two digits ('digital' style pads the minutes: 00:12).
    return parts.hours > 0
      ? new Format(i18n.locale, { hours: 'numeric', minutes: '2-digit', seconds: '2-digit' }).format(parts)
      : new Format(i18n.locale, { minutes: 'numeric', seconds: '2-digit' }).format({
          minutes: parts.minutes,
          seconds: parts.seconds,
        });
  } catch {
    // An engine without DurationFormat: minutes, a colon, two-digit seconds, in the locale's digits.
    const two = (n: number) => i18n.number(n, { minimumIntegerDigits: 2 });
    const head =
      parts.hours > 0 ? `${i18n.number(parts.hours)}:${two(parts.minutes)}` : i18n.number(parts.minutes);
    return `${head}:${two(parts.seconds)}`;
  }
}

/** Seconds with one decimal and the locale's unit: 1.5 s. For slots and shots, which are short. */
export function formatSeconds(i18n: I18n, seconds: number): string {
  return i18n.number(seconds, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: 1,
  });
}

/** A day: 3 Oct, or 3 Oct 2025 when it isn't this year. */
export function formatDay(i18n: I18n, epochMs: number, now = Date.now()): string {
  const sameYear = new Date(epochMs).getFullYear() === new Date(now).getFullYear();
  return i18n.date(new Date(epochMs), {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** The languages speech is transcribed in for v1 (P2-L8), named by the catalogue so translators own them. */
const SPEECH_LANGUAGES: Readonly<Record<string, MessageDescriptor>> = {
  en: msg`English`,
  hi: msg`Hindi`,
  es: msg`Spanish`,
  pt: msg`Portuguese`,
  'pt-BR': msg`Brazilian Portuguese`,
};

/** A language tag as its name in the UI's language: 'hi' → Hindi. Others by Intl. */
export function formatLanguage(i18n: I18n, tag: string): string {
  const known = SPEECH_LANGUAGES[tag];
  if (known) return i18n._(known);
  try {
    return new Intl.DisplayNames(i18n.locale, { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
