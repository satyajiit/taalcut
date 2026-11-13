// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The decode service switch (IX2-F14): which decodes go to the decode service, decided in one place for the
 * desktop's jobs process and the evals' indexing harness alike (`TAALCUT_DECODE_SERVICE`).
 *
 * - `mac-helper`, the default (unset, IX3-R2): the analysis pass through the service (IX2-V3) and the explicit frame
 *   reads (vision.embed's frames, IX2-G3: one decoder session per asset).
 * - `frames`: the frame reads through the service, the analysis pass on FFmpeg (the default in round IX2).
 * - `off`: FFmpeg decodes everything.
 *
 * Anything else is the default, with one warning. The switch only says what the service may take: where there is
 * no service (no mac helper: not a Mac, or a Mac without it) every decode stays on FFmpeg (helper-service.ts's
 * `openDecodeService`, the one place that opens it, says so once).
 */
import type { DecodeService, DecodeServiceTask } from './types';

export const DECODE_SERVICE_ENV = 'TAALCUT_DECODE_SERVICE';
export const DECODE_SERVICE_SETTINGS = ['off', 'frames', 'mac-helper'] as const;
export type DecodeServiceSetting = (typeof DECODE_SERVICE_SETTINGS)[number];

/**
 * The shipped default: the analysis pass and the frame reads through the service (IX3-R2, round IX3's decision 3
 * under the PO's "ok with your recommendations", `_orch/ix3/design.md`). On ix-v1 (IX2's official bench, 3 runs each,
 * same build) searchable went from 6.9 to 6.0 min/h and fully analysed from 13.6 to 11.7 against `frames`; shots,
 * analyses but on-screen text, and frame vectors were identical, and on-screen text read 20 of 24 words against 19
 * (IX3-R1, media SPEC "Decode service"). Reversed here, in one place.
 */
export const DEFAULT_DECODE_SERVICE: DecodeServiceSetting = 'mac-helper';

const TASKS: Readonly<Record<DecodeServiceSetting, readonly DecodeServiceTask[]>> = {
  off: [],
  frames: ['frames'],
  'mac-helper': ['pass', 'frames'],
};

const ALL_TASKS: readonly DecodeServiceTask[] = ['pass', 'frames'];

export interface DecodeServiceChoice {
  readonly setting: DecodeServiceSetting;
  /** What the service takes under it; none: no service at all. */
  readonly tasks: readonly DecodeServiceTask[];
  /** The switch's value when it named no setting and the default was taken. */
  readonly unknown?: string;
}

const isSetting = (value: string): value is DecodeServiceSetting => Object.hasOwn(TASKS, value);

/** The setting the switch's value names; unset or blank is the default, anything else too (`unknown` says what). */
export function decodeServiceChoice(value: string | undefined): DecodeServiceChoice {
  const given = value?.trim() ?? '';
  if (isSetting(given)) return { setting: given, tasks: TASKS[given] };
  const setting = DEFAULT_DECODE_SERVICE;
  return { setting, tasks: TASKS[setting], ...(given === '' ? {} : { unknown: given }) };
}

/** The one warning a value that named no setting is worth, or undefined (helper-service.ts says it, once). */
export function decodeServiceWarning(choice: DecodeServiceChoice): string | undefined {
  if (choice.unknown === undefined) return undefined;
  const settings = DECODE_SERVICE_SETTINGS.join(', ');
  return `${DECODE_SERVICE_ENV}=${choice.unknown} is not one of ${settings}: ${choice.setting}, the default`;
}

/** `service` when it takes `task` (one that doesn't say takes both), else undefined: FFmpeg decodes it. */
export function serviceFor(
  service: DecodeService | undefined,
  task: DecodeServiceTask,
): DecodeService | undefined {
  return service && (service.tasks ?? ALL_TASKS).includes(task) ? service : undefined;
}
