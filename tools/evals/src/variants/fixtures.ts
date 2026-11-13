// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The CLI label is only the case marker. Acceptable shot ids exist after planVariants runs,
 * so the file written here has none and the report omits pickAcceptance. The adapter test
 * asks planHookVariants for the sets.
 */
import { join } from 'node:path';
import { writeJson } from '../files';
import type { VariantLabel } from './schema';

export const VARIANT_CASE_ID = 'hook';
export const VARIANT_COUNT = 5;

export function variantMarker(): VariantLabel {
  return { caseId: VARIANT_CASE_ID, synthetic: true, count: VARIANT_COUNT };
}

export function writeVariantFixtures(dir: string): { labels: string } {
  writeJson(join(dir, 'cases.json'), [variantMarker()]);
  return { labels: dir };
}
