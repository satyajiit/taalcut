// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { MAX_HUB_PROBLEMS, type HubProblem } from '@taalcut/core/hub';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Each `{ path, rule }` once, at most MAX_HUB_PROBLEMS, as the error body allows. */
export function dedupeProblems(problems: readonly HubProblem[]): HubProblem[] {
  const seen = new Set<string>();
  const unique: HubProblem[] = [];
  for (const problem of problems) {
    const key = `${problem.path}\u0000${problem.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(problem);
  }
  return unique.slice(0, MAX_HUB_PROBLEMS);
}

export function zodProblems(error: { issues: readonly { path: readonly PropertyKey[] }[] }): HubProblem[] {
  return error.issues.map((issue) => ({
    path: issue.path
      .map((part) => String(part))
      .join('.')
      .slice(0, 200),
    rule: 'schema',
  }));
}
