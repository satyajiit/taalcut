// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The most problems a script prints for one run (a bad document can have thousands). */
export const MAX_PRINTED_PROBLEMS = 50;

/** `<file>: <json path>: <rule>`, or `<file>: <rule>` for the whole file. */
export function formatProblem(rel, problem) {
  return problem.jsonPath ? `${rel}: ${problem.jsonPath}: ${problem.rule}` : `${rel}: ${problem.rule}`;
}
