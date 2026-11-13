// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Telemetry's namespaces in the agent process (P2-X7). The queue, its
 * consent and Local-only gates and the transport are the desktop's telemetry
 * service (core's `Telemetry`, apps/desktop SPEC "Telemetry service"); these
 * routers only hand events to it. A window may record only its own events
 * (core's telemetryContract refuses the rest as core.validation); other
 * processes hand theirs over `telemetryIngest`, which main forwards.
 */
import {
  implementContract,
  ok,
  TELEMETRY_SETTING,
  telemetryContract,
  telemetryIngestContract,
  unwrapRpc,
  type AsyncResult,
  type ProjectId,
  type SettingsStore,
  type Telemetry,
} from '@taalcut/core';

/** What Settings → Privacy shows about telemetry. */
export interface TelemetryState {
  readonly enabled: boolean;
  readonly cohort?: string;
  /** Envelopes waiting to be sent. */
  readonly queued: number;
  readonly lastSentAt?: number;
}

export interface TelemetryRouterDeps {
  readonly telemetry: Telemetry;
  readonly state: () => AsyncResult<TelemetryState>;
}

const contextOf = (projectId: ProjectId | undefined) => (projectId ? { projectId } : undefined);

/** appContract.telemetry (owner agent): the state, and a window's own events. */
export function telemetryRouter(deps: TelemetryRouterDeps) {
  const os = implementContract(telemetryContract);
  return os.router({
    state: os.state.handler(async () => {
      const { enabled, cohort, queued, lastSentAt } = unwrapRpc(await deps.state());
      return {
        enabled,
        queued,
        ...(cohort !== undefined ? { cohort } : {}),
        ...(lastSentAt !== undefined ? { lastSentAt } : {}),
      };
    }),
    record: os.record.handler(({ input }) => {
      deps.telemetry.record(input.event, contextOf(input.projectId));
    }),
  });
}

/** UTILITY_CONTRACTS.agent.telemetryIngest: main, jobs, render and the LAN process hand their events over. */
export function telemetryIngestRouter(telemetry: Telemetry) {
  const os = implementContract(telemetryIngestContract);
  return os.router({
    record: os.record.handler(({ input }) => {
      telemetry.record(input.event, contextOf(input.projectId));
    }),
  });
}

/** The state from TELEMETRY_SETTING, with the queue's numbers when the telemetry service gives them. */
export function settingsTelemetryState(
  settings: SettingsStore,
  queue?: () => { readonly queued: number; readonly lastSentAt?: number },
): () => AsyncResult<TelemetryState> {
  return async () => {
    const stored = await settings.get(TELEMETRY_SETTING);
    if (!stored.ok) return stored;
    const { queued, lastSentAt } = queue?.() ?? { queued: 0 };
    return ok({
      enabled: stored.value.enabled,
      queued,
      ...(stored.value.cohort !== undefined ? { cohort: stored.value.cohort } : {}),
      ...(lastSentAt !== undefined ? { lastSentAt } : {}),
    });
  };
}
