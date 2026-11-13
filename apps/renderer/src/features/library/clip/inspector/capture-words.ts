// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-OEM: when a clip was shot, in the time where it was shot, and what made it. Times are formatted with Intl
 * in the clip's own zone ('+02:00'); the zone is named by Intl too ("GMT+2"), so each language writes it its way.
 * Product names (the phone, its lens, the app) are the maker's and shown as written.
 */
import type { I18n } from '@lingui/core';
import type { CaptureOffset, MediaFacts } from '@taalcut/core';
import { cameraName } from '../clip-facts-data';

/** +120 as the '+02:00' Intl takes for a time zone. */
export function offsetZone(minutes: number): string {
  const abs = Math.abs(minutes);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${minutes < 0 ? '-' : '+'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** The day and time, in the zone it was shot in when that is known, else in this computer's. */
export function captureDateTime(
  i18n: I18n,
  epochMs: number,
  offset: CaptureOffset | null | undefined,
): string {
  return i18n.date(new Date(epochMs), {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(offset ? { timeZone: offsetZone(offset.minutes) } : {}),
  });
}

/** The zone's name in the reader's language: "GMT+2", "GMT+5:30". */
export function zoneName(i18n: I18n, epochMs: number, minutes: number): string {
  const parts = new Intl.DateTimeFormat(i18n.locale, {
    timeZone: offsetZone(minutes),
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(epochMs));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? offsetZone(minutes);
}

/**
 * What the camera row names: the camera ("Samsung Galaxy Example") with its model number or lens, or, for a file an
 * app wrote and no camera named, that app on its own ("From the Sample Cam app"). The device code an app writes
 * beside its name (`appDevice`, "XC01") is that app's internal code, not a name a person knows, so it is never part
 * of what the row says; the clip's facts keep it. Null when the file names neither a camera nor an app.
 */
export interface CameraWords {
  readonly camera: string | null;
  readonly app: string | null;
  readonly detail: string | null;
}

export function cameraWords(device: MediaFacts['device']): CameraWords | null {
  const camera = cameraName(device);
  const app = device?.app?.trim() || null;
  if (!camera && !app) return null;
  return { camera, app, detail: cameraDetail(device) };
}

/**
 * What the camera row says under its name: Samsung's model number, or the lens Apple names without the phone's
 * name it starts with ("back triple camera 6.765mm f/1.78").
 */
export function cameraDetail(device: MediaFacts['device']): string | null {
  if (device?.modelCode) return device.modelCode;
  const lens = device?.lens?.trim();
  if (!lens) return null;
  const model = device?.model?.trim();
  const short =
    model && lens.toLowerCase().startsWith(model.toLowerCase()) ? lens.slice(model.length).trim() : lens;
  return short || lens;
}
