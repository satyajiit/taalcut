// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What each of runQa's measuring passes runs with: the render, its context and the checks wanted. */
import type { QaCheckId, QaCheckResult } from '@taalcut/core';
import type { QaContext, RunQaInput } from '../run-qa-input';

export interface PassScope {
  readonly input: RunQaInput;
  readonly ctx: QaContext;
  readonly wanted: ReadonlySet<QaCheckId>;
}

export const wants = (scope: PassScope, ...ids: QaCheckId[]) => ids.some((id) => scope.wanted.has(id));

/** A pass's checks with its measuring time shared out among them. */
export function timed(results: readonly QaCheckResult[], started: number): QaCheckResult[] {
  const share = (performance.now() - started) / Math.max(1, results.length);
  return results.map((result) => ({ ...result, durationMs: Math.round(result.durationMs + share) }));
}
