// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a clip was shot, in the time where it was shot (LIB1-OEM). Each device says it its own way:
 * - Apple writes the local time with its offset (`com.apple.quicktime.creationdate`, '2023-08-30T09:56:22-0400');
 * - Samsung writes the UTC instant (`creation_time`) and the offset beside it (`com.samsung.android.utc_offset`,
 *   '+0200'), so the local time is the instant moved by the offset;
 * - a photo's EXIF has the local time ('2026:03:01 12:34:56') and, from 2016 on, `OffsetTimeOriginal` ('+05:30');
 * - every other MP4 has only the UTC instant: its local time isn't known, so it has no offset.
 * The result is ISO 8601 with the offset when there is one ('2026-03-14T11:30:00+02:00'), else as written.
 */
import { CAPTURE_OFFSET_MAX, CAPTURE_OFFSET_MIN } from '@taalcut/core';

export interface CaptureTime {
  readonly captureTime: string;
  /** Minutes east of UTC, when the file names its zone. */
  readonly captureOffsetMin?: number;
}

export interface CaptureTimeInput {
  /** A photo's EXIF time and offset (the mac helper's `captureTime` and `offsetTime`). */
  readonly still?: { readonly captureTime?: string; readonly offsetTime?: string };
  /** Apple's local time with its offset. */
  readonly creationDate?: string;
  /** Samsung's offset: '+0200'. */
  readonly utcOffset?: string;
  /** The container's creation time (UTC). */
  readonly creationTime?: string;
}

const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const EXIF = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?$/;
/** A clock that was never set writes 1904 (QuickTime's epoch) or 1970: no capture time at all. */
const EARLIEST_YEAR = 1990;

/** '+0200', '+02:00', '-0330' as minutes east of UTC; undefined for anything else or out of range. */
export function offsetMinutes(text: string | undefined): number | undefined {
  const match = text ? OFFSET.exec(text.trim()) : null;
  if (!match) return undefined;
  const [, sign, hours, minutes] = match;
  if (Number(minutes) >= 60) return undefined;
  const value = (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  return value >= CAPTURE_OFFSET_MIN && value <= CAPTURE_OFFSET_MAX ? value : undefined;
}

/** +120 as '+02:00'. */
function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

interface WallTime {
  /** 'YYYY-MM-DDTHH:MM:SS' plus milliseconds when not zero. */
  readonly local: string;
  /** What followed it: 'Z', an offset, or nothing. */
  readonly zone?: string;
  readonly year: number;
}

function wallTime(text: string | undefined): WallTime | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const iso = ISO.exec(trimmed);
  const exif = iso ? null : EXIF.exec(trimmed);
  const match = iso ?? exif;
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s, frac, zone] = match;
  const ms = frac ? Math.round(Number(frac) * 1000) : 0;
  const millis = ms > 0 && ms < 1000 ? `.${String(ms).padStart(3, '0')}` : '';
  return {
    local: `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${millis}`,
    ...(iso && zone ? { zone } : {}),
    year: Number(y),
  };
}

/** A wall time read as UTC, moved by `minutes`: the local time there. */
function shifted(utc: WallTime, minutes: number): string | undefined {
  const at = Date.parse(`${utc.local}Z`);
  if (!Number.isFinite(at)) return undefined;
  const local = new Date(at + minutes * 60_000).toISOString();
  return local.endsWith('.000Z') ? local.slice(0, 19) : local.slice(0, 23);
}

function withZone(time: WallTime, minutes: number | undefined): CaptureTime {
  if (minutes !== undefined)
    return { captureTime: `${time.local}${offsetText(minutes)}`, captureOffsetMin: minutes };
  return { captureTime: `${time.local}${time.zone ?? ''}` };
}

function plausible(time: WallTime | undefined): time is WallTime {
  return time !== undefined && time.year >= EARLIEST_YEAR;
}

export function captureTimeOf(input: CaptureTimeInput): CaptureTime | undefined {
  const still = wallTime(input.still?.captureTime);
  if (plausible(still)) {
    const zone = still.zone && still.zone !== 'Z' ? still.zone : input.still?.offsetTime;
    return withZone(still, offsetMinutes(zone));
  }
  const apple = wallTime(input.creationDate);
  if (plausible(apple)) return withZone(apple, apple.zone === 'Z' ? undefined : offsetMinutes(apple.zone));
  const utc = wallTime(input.creationTime);
  if (!plausible(utc)) return undefined;
  const samsung = offsetMinutes(input.utcOffset);
  // Samsung's offset applies to a UTC instant; a time already in local wall time keeps its own zone.
  if (samsung !== undefined && (utc.zone === 'Z' || utc.zone === undefined)) {
    const local = shifted(utc, samsung);
    if (local) return { captureTime: `${local}${offsetText(samsung)}`, captureOffsetMin: samsung };
  }
  return withZone(utc, utc.zone && utc.zone !== 'Z' ? offsetMinutes(utc.zone) : undefined);
}
