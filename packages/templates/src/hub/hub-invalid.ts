// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `hub.invalid` from a failed parse: the count as the param and, as core's HubInvalid says, the problems (paths
 * and rules, never the values) in `detail`.
 */
import { HubInvalid, MAX_HUB_PROBLEMS, type HubProblem, type TaalcutError } from '@taalcut/core';
import type { z } from 'zod';

export function schemaProblems(error: z.ZodError): HubProblem[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), rule: 'schema' }));
}

export function hubInvalid(problems: readonly HubProblem[]): TaalcutError {
  return HubInvalid(
    { problems: problems.length },
    { detail: JSON.stringify(problems.slice(0, MAX_HUB_PROBLEMS)) },
  );
}

export function hubInvalidFrom(error: z.ZodError): TaalcutError {
  return hubInvalid(schemaProblems(error));
}
