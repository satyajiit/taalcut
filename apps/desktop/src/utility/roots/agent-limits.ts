// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G8 in the agent process: the usage limits the model client notes (models' tracker, served as core's
 * UsageLimits to Settings › Usage through `usage.limits` and `usage.limitsChanged`), and the limits a
 * rateLimit card reads. The follower that resumes waiting runs is agent-limits-follower.ts.
 */
import { UsageLimitsToken, type Container } from '@taalcut/core';
import type { Phase3Deps } from '@taalcut/agent';
import { createUsageLimitsTracker, UsageLimitsTrackerToken, type LimitObserver } from '@taalcut/models';

export function registerUsageLimits(container: Container): void {
  container.factory(UsageLimitsTrackerToken, () => createUsageLimitsTracker());
  container.factory(UsageLimitsToken, ({ tracker }) => tracker, {
    deps: { tracker: UsageLimitsTrackerToken },
  });
}

/** The model client's `limits`: every limit a call meets and every success that lifts one. */
export function modelClientLimits(container: Container): { limits?: LimitObserver } {
  return container.has(UsageLimitsTrackerToken) ? { limits: container.resolve(UsageLimitsTrackerToken) } : {};
}

/** The agent's `phase3.limits`: a rateLimit card leaves out the module's other limited models. */
export function limitsAgentDeps(container: Container): Pick<Phase3Deps, 'limits'> {
  if (!container.has(UsageLimitsTrackerToken)) return {};
  const tracker = container.resolve(UsageLimitsTrackerToken);
  return { limits: { current: () => tracker.current() } };
}
