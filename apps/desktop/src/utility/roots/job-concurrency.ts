// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The job engine's class budgets and model lanes from this machine (round IX, design A): models' lane plan
 * for the probed hardware at its tier (the assessed one, or the bench's forced one: both arrive through
 * `macHardware`). The engine starts on its defaults, the minimum Apple row, and takes the plan when the
 * probe answers; a failed probe keeps the defaults and says so.
 */
import { describeConcurrency, planJobConcurrency, type PlannedConcurrency } from '@taalcut/models';
import type { JobEngine } from '@taalcut/jobs';
import type { ProbedHardware } from '../../shared/tokens';

export async function applyHardwarePlan(
  engine: Pick<JobEngine, 'applyPlan'>,
  hardware: () => Promise<ProbedHardware>,
  log: (message: string) => void = (message) => console.warn(`[jobs] ${message}`),
): Promise<PlannedConcurrency | undefined> {
  let probed: ProbedHardware;
  try {
    probed = await hardware();
  } catch (cause) {
    log(`hardware probe failed, keeping the minimum concurrency: ${String(cause)}`);
    return undefined;
  }
  const planned = planJobConcurrency(probed.info, probed.assessment.tier);
  engine.applyPlan(planned.plan);
  log(`concurrency ${describeConcurrency(planned)} (tier ${probed.assessment.tier})`);
  return planned;
}
