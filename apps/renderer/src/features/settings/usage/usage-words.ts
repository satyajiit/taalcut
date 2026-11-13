// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Usage's names for what it counts: a job (a model module), a provider, a project, and the units
 * providers bill that aren't tokens. Names come from the catalogue; counts through Intl (plural rules too).
 */
import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { BilledUnit, ModelModuleId } from '@taalcut/core';
import { formatUsd } from '../../shared/format';
import { translateKey } from '../model-messages';
import { providerName } from '../providers';

const JOB_FALLBACK = msg`Other`;

/** "Seeing your clips": the job's name as Settings › Models shows it. */
export function jobName(i18n: I18n, module: ModelModuleId): string {
  return translateKey(i18n, `models.module.${module}.label`, JOB_FALLBACK);
}

/** The provider's name, or null for one the catalogue doesn't know (show its id, translate="no"). */
export function providerLabel(i18n: I18n, provider: string, local: boolean): string | null {
  return local ? i18n._(msg`On this Mac`) : providerName(i18n, provider);
}

/** The units that aren't tokens, in the order the Units tile lists them. */
export const OTHER_UNITS = [
  'character',
  'second',
  'image',
  'credit',
] as const satisfies readonly BilledUnit[];
export type OtherUnit = (typeof OTHER_UNITS)[number];

/** "1,240 characters", "6 images": a billed quantity in words, counted with the locale's plural rules. */
export function unitAmount(i18n: I18n, unit: OtherUnit, quantity: number): string {
  const count = Math.round(quantity);
  switch (unit) {
    case 'character':
      return i18n._(msg`${plural(count, { one: '# character', other: '# characters' })}`);
    case 'second':
      return i18n._(msg`${plural(count, { one: '# second of audio', other: '# seconds of audio' })}`);
    case 'image':
      return i18n._(msg`${plural(count, { one: '# image', other: '# images' })}`);
    case 'credit':
      return i18n._(msg`${plural(count, { one: '# credit', other: '# credits' })}`);
  }
}

/** A total in whole cents ($12.46); below a cent, two significant digits as everywhere else ($0.0042). */
export function moneyShort(i18n: I18n, usd: number): string {
  if (usd > 0 && usd < 0.01) return formatUsd(i18n, usd);
  return i18n.number(usd, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
