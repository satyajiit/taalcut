// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two events main records: session.started once the window is showing,
 * recovery.offered when the recovery prompt is shown. An input the catalogue
 * rejects is not recorded.
 */
import {
  telemetryEventSchema,
  type TELEMETRY_PROFILES,
  type AppLocale,
  type HardwareTier,
  type Telemetry,
  type TelemetryEvent,
  type UpdateChannel,
} from '@taalcut/core';

export interface SessionStartedFacts {
  readonly appVersion: string;
  readonly channel: UpdateChannel;
  readonly osMajor: number;
  readonly tier: HardwareTier;
  readonly locale: AppLocale;
  readonly profile: (typeof TELEMETRY_PROFILES)[number];
}

export interface RecoveryOfferedFacts {
  readonly runs: number;
  readonly jobs: number;
  readonly restored: boolean;
}

/** A catalogue session.started, or undefined when the facts are not sendable. */
export function sessionStartedEvent(facts: SessionStartedFacts): TelemetryEvent | undefined {
  const parsed = telemetryEventSchema.safeParse({ name: 'session.started', ...facts });
  return parsed.success && parsed.data.name === 'session.started' ? parsed.data : undefined;
}

export function recordSessionStarted(service: Telemetry, facts: SessionStartedFacts): void {
  const event = sessionStartedEvent(facts);
  if (event) service.record(event);
}

export function recordRecoveryOffered(service: Telemetry, facts: RecoveryOfferedFacts): void {
  const parsed = telemetryEventSchema.safeParse({ name: 'recovery.offered', ...facts });
  if (parsed.success && parsed.data.name === 'recovery.offered') service.record(parsed.data);
}
