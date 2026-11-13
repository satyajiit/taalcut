// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How good the estimates were (P2-X1 "within ±30% of actual"): pairs each
 * `estimate.recorded` with its `estimate.settled` across run logs and checks
 * the evals rule (tools/evals SPEC, `cost`): an estimate whose actual cost is
 * at least US$0.01 must be within ±30%; a smaller one within US$0.003. The
 * evals lane's `cost` command reads paid eval runs' logs through this.
 */
import type { AgentEvent, EventOf } from './events';
import type { EstimateLine } from './flow-events';

export const COST_TOLERANCE = 0.3;
/** Below this actual cost the check is absolute, not relative. */
export const SMALL_COST_USD = 0.01;
export const SMALL_COST_TOLERANCE_USD = 0.003;

export interface CostPair {
  readonly runId: string;
  readonly estimateId: string;
  readonly stepId?: string;
  readonly skill?: string;
  readonly tool?: string;
  readonly lines: readonly EstimateLine[];
  readonly estimateUsd: number;
  readonly actualUsd: number;
  /** (estimate − actual) / actual; Infinity when nothing was spent but something was estimated. */
  readonly error: number;
  readonly within: boolean;
}

export interface CostAccuracyReport {
  readonly pairs: readonly CostPair[];
  /** Estimates never settled (a run that stopped mid-step). Not counted. */
  readonly unsettled: readonly { readonly runId: string; readonly estimateId: string }[];
  readonly outliers: readonly CostPair[];
  readonly passed: boolean;
}

export function withinTolerance(estimateUsd: number, actualUsd: number): boolean {
  if (actualUsd < SMALL_COST_USD)
    return Math.abs(estimateUsd - actualUsd) <= SMALL_COST_TOLERANCE_USD + 1e-12;
  return Math.abs(estimateUsd - actualUsd) <= COST_TOLERANCE * actualUsd + 1e-12;
}

export function costAccuracy(runs: readonly (readonly AgentEvent[])[]): CostAccuracyReport {
  const pairs: CostPair[] = [];
  const unsettled: { runId: string; estimateId: string }[] = [];
  for (const events of runs) {
    const settled = new Map(
      events
        .filter((e): e is EventOf<'estimate.settled'> => e.type === 'estimate.settled')
        .map((e) => [e.payload.estimateId, e.payload.actual]),
    );
    for (const event of events) {
      if (event.type !== 'estimate.recorded') continue;
      const p = event.payload;
      const actual = settled.get(p.estimateId);
      if (!actual) {
        unsettled.push({ runId: event.runId, estimateId: p.estimateId });
        continue;
      }
      const error =
        actual.usd > 0 ? (p.estimate.usd - actual.usd) / actual.usd : p.estimate.usd > 0 ? Infinity : 0;
      pairs.push({
        runId: event.runId,
        estimateId: p.estimateId,
        ...(p.stepId ? { stepId: p.stepId } : {}),
        ...(p.skill ? { skill: p.skill } : {}),
        ...(p.tool ? { tool: p.tool } : {}),
        lines: p.lines,
        estimateUsd: p.estimate.usd,
        actualUsd: actual.usd,
        error,
        within: withinTolerance(p.estimate.usd, actual.usd),
      });
    }
  }
  const outliers = pairs.filter((pair) => !pair.within);
  return { pairs, unsettled, outliers, passed: outliers.length === 0 };
}
