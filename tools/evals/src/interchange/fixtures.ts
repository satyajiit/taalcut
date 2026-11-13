// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import type { InterchangeLabel } from './schema';

/** The fixture timeline length. A unit test may build a shorter one. */
export const clipCount = 30;

export const INTERCHANGE_CASE_ID = 'cuts';

export function interchangeMarker(count = clipCount): InterchangeLabel {
  return { caseId: INTERCHANGE_CASE_ID, synthetic: true, clipCount: count };
}

export function writeInterchangeFixtures(dir: string): { labels: string } {
  writeJson(join(dir, 'cases.json'), [interchangeMarker()]);
  return { labels: dir };
}
