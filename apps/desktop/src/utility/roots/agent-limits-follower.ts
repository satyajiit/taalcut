// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G8's rate-limit follower in the agent process: it resumes a run waiting for a model limit when the limit
 * lifts (also after a restart, from the log), shows the run waiting on the usage limits and records
 * `rateLimit.met`. Kept apart from agent-limits.ts so the agent's own wiring doesn't import the agent token.
 */
import { createToken, EventLogStoreToken, noTelemetry, TelemetryToken, type Container } from '@taalcut/core';
import { createRateLimitFollower, fromCoreEventLog, type RateLimitFollower } from '@taalcut/agent';
import { UsageLimitsTrackerToken } from '@taalcut/models';
import { AgentToken } from './agent-loop';

export const RateLimitFollowerToken = createToken<RateLimitFollower>('agent.rateLimitFollower');

export function registerRateLimitFollower(container: Container): void {
  container.factory(
    RateLimitFollowerToken,
    ({ agent, log, tracker }) =>
      createRateLimitFollower({
        agent,
        log: fromCoreEventLog(log),
        limits: tracker,
        telemetry: container.has(TelemetryToken) ? container.resolve(TelemetryToken) : noTelemetry,
      }),
    {
      deps: { agent: AgentToken, log: EventLogStoreToken, tracker: UsageLimitsTrackerToken },
      dispose: (follower) => follower.close(),
    },
  );
}

/** At start: time every run that was waiting for a limit when the app quit. */
export async function startRateLimitFollower(container: Container): Promise<void> {
  await container.resolve(RateLimitFollowerToken).start();
}
