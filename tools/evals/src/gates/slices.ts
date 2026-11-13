// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export type GateId = 'beta' | 'v1';

export type CohortSlice = 'all' | 'alpha' | 'fresh-beta' | 'beta';

export type LanguageSlice = 'all' | 'en' | 'hi' | 'es' | 'pt-BR';

/**
 * Cohort and language are always set. Release, channel and runner are set only on the slices that
 * have them, so a crash row is not stuffed into `cohort`.
 */
export interface CellSlice {
  cohort: CohortSlice;
  language: LanguageSlice;
  release?: string;
  channel?: string;
  runner?: string;
}

export const COHORT_NAMES = ['alpha', 'fresh-beta', 'beta'] as const;
export type CohortName = (typeof COHORT_NAMES)[number];

export const LANGUAGE_NAMES = ['en', 'hi', 'es', 'pt-BR'] as const;
export type LanguageName = (typeof LANGUAGE_NAMES)[number];

export const COHORT_SLICES = ['all', 'alpha', 'fresh-beta', 'beta'] as const satisfies readonly CohortSlice[];
export const LANGUAGE_SLICES = ['all', 'en', 'hi', 'es', 'pt-BR'] as const satisfies readonly LanguageSlice[];

export function cohortLanguageSlices(): CellSlice[] {
  const slices: CellSlice[] = [];
  for (const cohort of COHORT_SLICES) {
    for (const language of LANGUAGE_SLICES) {
      slices.push({ cohort, language });
    }
  }
  return slices;
}

/** A null cohort or language is only in the `all` slice. It is not dropped and not invented as a code. */
export function matchesSlice(
  cohort: CohortName | null,
  language: LanguageName | null,
  slice: CellSlice,
): boolean {
  if (slice.cohort !== 'all' && slice.cohort !== cohort) return false;
  if (slice.language !== 'all' && slice.language !== language) return false;
  return true;
}

export function sliceLabel(slice: CellSlice): string {
  const parts: string[] = [slice.cohort, slice.language];
  if (slice.release !== undefined) parts.push(slice.release);
  if (slice.channel !== undefined) parts.push(slice.channel);
  if (slice.runner !== undefined) parts.push(slice.runner);
  return parts.join(' / ');
}
