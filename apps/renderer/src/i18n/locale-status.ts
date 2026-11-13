// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where each language's translation is (P3-L1 rule 6): draft, in review or signed off by a native reviewer, from
 * the one status file the translation checks read too. The switcher marks the ones not yet signed off.
 */
import type { AppLocale } from '@taalcut/core';
import status from '../locales/status.json';

export type LocaleStatus = 'draft' | 'in-review' | 'signed-off';

const STATUSES: readonly LocaleStatus[] = ['draft', 'in-review', 'signed-off'];
const known: Readonly<Record<string, unknown>> = status;

/** A language without a status line counts as a draft. */
export function localeStatus(locale: AppLocale): LocaleStatus {
  const value = known[locale];
  return STATUSES.find((each) => each === value) ?? 'draft';
}
