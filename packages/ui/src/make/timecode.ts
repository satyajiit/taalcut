// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timecodes and lengths for the Make surfaces (P2-M7): media time crosses as
 * frames at a rational rate (never float seconds); only the words on screen
 * are made here, with Intl. `clock` is the digital form an editor reads
 * ("00:04", "00:04.12", "1:02:03"); `length` the narrow unit form ("1.5s").
 */
import { useLingui } from '@lingui/react';
import { useMemo } from 'react';
import { createFormatters } from '#lib/format';

/** A rate as core's FrameRate: `num` units per `den` seconds. */
export interface Rate {
  readonly num: number;
  readonly den: number;
}

/** Milliseconds in `frames` at `rate` (rounded to the millisecond, for display only). */
export function framesToMs(frames: number, rate: Rate): number {
  return Math.round((frames * 1000 * rate.den) / rate.num);
}

/** Frames in `ms` at `rate`, rounded to the nearest frame. */
export function msToFrames(ms: number, rate: Rate): number {
  return Math.round((ms * rate.num) / (rate.den * 1000));
}

interface DurationParts {
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}
interface DurationFormatLike {
  format(duration: DurationParts): string;
}
type DurationFormatCtor = new (
  locale: string,
  options: { style: 'digital'; hoursDisplay?: 'auto' | 'always'; fractionalDigits?: number },
) => DurationFormatLike;

// The repository's lib is ES2024; Intl.DurationFormat (ES2025) ships in Electron's Chromium and Node 24.
const DurationFormat = (Intl as unknown as { DurationFormat?: DurationFormatCtor }).DurationFormat;

/** Locales the app shows that Intl doesn't know: the pseudo-locale formats like English. */
const intlLocale = (locale: string) => (locale === 'en-XA' ? 'en' : locale);

export interface Timecode {
  /** "00:04" (or "00:04.12" with `fraction`), "1:02:03" past an hour. Floors to the frame's time. */
  clock(frames: number, rate: Rate, options?: { readonly fraction?: boolean }): string;
  /** "1.5s", "3m 12s": a length in the kit's narrow units. */
  length(frames: number, rate: Rate): string;
}

export function createTimecode(locale: string): Timecode {
  const intl = intlLocale(locale);
  const whole = DurationFormat
    ? new DurationFormat(intl, { style: 'digital', hoursDisplay: 'auto', fractionalDigits: 0 })
    : null;
  const fine = DurationFormat
    ? new DurationFormat(intl, { style: 'digital', hoursDisplay: 'auto', fractionalDigits: 2 })
    : null;
  const two = new Intl.NumberFormat(intl, { minimumIntegerDigits: 2, useGrouping: false });
  const one = new Intl.NumberFormat(intl, { useGrouping: false });
  const decimal =
    new Intl.NumberFormat(intl).formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.';
  const formatters = createFormatters(locale);

  return {
    clock(frames, rate, options) {
      const total = Math.max(0, framesToMs(frames, rate));
      const hours = Math.floor(total / 3_600_000);
      const minutes = Math.floor((total % 3_600_000) / 60_000);
      const seconds = Math.floor((total % 60_000) / 1000);
      const centis = Math.floor((total % 1000) / 10);
      const parts: DurationParts = { hours, minutes, seconds };
      if (options?.fraction) {
        if (fine) return fine.format({ ...parts, milliseconds: centis * 10 });
      } else if (whole) {
        return whole.format(parts);
      }
      // Without DurationFormat: the same digital shape from Intl number parts.
      const head = hours > 0 ? `${one.format(hours)}:${two.format(minutes)}` : two.format(minutes);
      const tail = options?.fraction ? `${decimal}${two.format(centis)}` : '';
      return `${head}:${two.format(seconds)}${tail}`;
    },
    length: (frames, rate) => formatters.duration(framesToMs(frames, rate)),
  };
}

/** Timecodes in the active language. */
export function useTimecode(): Timecode {
  const { i18n } = useLingui();
  const locale = i18n.locale;
  return useMemo(() => createTimecode(locale), [locale]);
}
