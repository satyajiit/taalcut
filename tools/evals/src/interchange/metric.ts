// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { InterchangePrediction } from './schema';

/**
 * Every cut and in-point reads back at the same frame. The plan allows 1 frame; the writers use exact rational time,
 * so this suite holds them to 0. An external tool being absent is not a miss; one that rejects the file is.
 */
export const INTERCHANGE_BARS = { maxCutDeltaFrames: 0 } as const;

export interface InterchangeCaseScore {
  readonly caseId: string;
  readonly maxCutDeltaFrames: number;
  readonly formats: InterchangePrediction['formats'];
}

export function scoreInterchangeCase(row: InterchangePrediction): InterchangeCaseScore {
  const maxCutDeltaFrames = row.formats.reduce((max, format) => Math.max(max, format.maxCutDeltaFrames), 0);
  return { caseId: row.caseId, maxCutDeltaFrames, formats: row.formats };
}

export function interchangeGatePasses(row: InterchangeCaseScore): boolean {
  return (
    row.maxCutDeltaFrames <= INTERCHANGE_BARS.maxCutDeltaFrames &&
    row.formats.every((format) => format.externalStatus !== 'failed')
  );
}
