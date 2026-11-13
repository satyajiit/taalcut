// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { COHORT_CODE_PATTERN } from '@taalcut/core';
import { z } from 'zod';
import { readJson } from '../../files';
import { COHORT_NAMES, type CohortName } from '../slices';
import { sourceOf } from './digest';
import { parseWith } from './parse';
import { type SourceRef } from './types';

const cohortsSchema = z.record(z.string().regex(COHORT_CODE_PATTERN), z.enum(COHORT_NAMES));

export interface CohortFile {
  map: ReadonlyMap<string, CohortName>;
  source: SourceRef | null;
}

/** An omitted path is an empty map. A path that does not read is an error, not an empty map. */
export function loadCohorts(path: string | undefined): CohortFile {
  if (path === undefined) return { map: new Map(), source: null };
  const parsed = parseWith(cohortsSchema, readJson(path), path);
  return { map: new Map(Object.entries(parsed)), source: sourceOf(path, false) };
}

export function cohortName(map: ReadonlyMap<string, CohortName>, code: string): CohortName {
  const name = map.get(code);
  if (name === undefined) {
    throw new Error(`Unknown cohort code ${code}. Codes in the telemetry must be listed in --cohorts.`);
  }
  return name;
}
