// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Verdicts and summaries (docs/qa-gate.md, rules 3 and 4): `passed` has no
 * fail and no warn; `passedWithWarnings` has warns only; `needsAttention`
 * keeps a fail after the fixes; `overridden` is the user's "Export anyway"
 * over failures that are all overridable. A check fixed in place counts as
 * passing.
 */
import type { QaCheckResult, QaReport, QaSummary, QA_VERDICTS } from '@taalcut/core';
import { QA_CHECKS } from './result';

export type QaVerdict = (typeof QA_VERDICTS)[number];

export function verdictOf(checks: readonly QaCheckResult[], overrides: QaReport['overrides']): QaVerdict {
  const failing = checks.filter((check) => check.status === 'fail');
  if (failing.length > 0) {
    const overridden = new Set(overrides.map((entry) => entry.check));
    const allOverridden = failing.every((check) => check.overridable && overridden.has(check.id));
    return allOverridden ? 'overridden' : 'needsAttention';
  }
  return checks.some((check) => check.status === 'warn') ? 'passedWithWarnings' : 'passed';
}

/** The verdicts that let a file reach the renders folder. */
export const DELIVERABLE_VERDICTS: ReadonlySet<QaVerdict> = new Set(['passed', 'passedWithWarnings', 'overridden']);

export function summarize(report: Pick<QaReport, 'checks' | 'verdict' | 'round'>): QaSummary {
  const count = (status: QaCheckResult['status']) => report.checks.filter((check) => check.status === status).length;
  return {
    verdict: report.verdict,
    round: report.round,
    passed: count('pass'),
    warned: count('warn'),
    failed: count('fail'),
    fixed: count('fixed'),
    failing: report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
  };
}

/** Results in QA_CHECKS order, so every report reads the same way. */
export function orderChecks(checks: readonly QaCheckResult[]): QaCheckResult[] {
  const order = new Map(QA_CHECKS.map((meta, index) => [meta.id, index]));
  return [...checks].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

/**
 * Re-run results replace the earlier ones by id. A check that failed before a fix and passes (or only
 * warns) now is `fixed`; one that still fails stays `fail`.
 */
export function mergeRerun(previous: readonly QaCheckResult[], rerun: readonly QaCheckResult[]): QaCheckResult[] {
  const byId = new Map(previous.map((check) => [check.id, check]));
  for (const result of rerun) {
    const before = byId.get(result.id);
    const wasFailing = before?.status === 'fail' || before?.status === 'fixed';
    const nowPasses = result.status === 'pass' || result.status === 'warn';
    byId.set(result.id, wasFailing && nowPasses ? { ...result, status: 'fixed', fixes: [] } : result);
  }
  return orderChecks([...byId.values()]);
}

/** The card face: failing first, then fixed, then warnings (at most `limit`). */
export function cardChecks(report: Pick<QaReport, 'checks'>, limit = 6): QaCheckResult[] {
  const rank = { fail: 0, fixed: 1, warn: 2 } as Record<string, number>;
  return report.checks
    .filter((check) => check.status in rank)
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
    .slice(0, limit);
}
