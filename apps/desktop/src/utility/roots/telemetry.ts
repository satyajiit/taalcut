// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent-process telemetry (P2-X7). The implementation lives in
 * utility/telemetry; this is the root the SPEC names. registerAgentTelemetry
 * binds core's TelemetryToken before the agent routers resolve it. The queue
 * is the library outbox when this container has a library database.
 */
import { ClockToken, SettingsStoreToken, TelemetryToken, type Container } from '@taalcut/core';
import { createTelemetryOutbox } from '@taalcut/library';
import { LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';
import {
  adaptLibraryTelemetryOutbox,
  createFileTelemetryOutbox,
  createTelemetryScheduler,
  createTelemetryService,
  TelemetryServiceToken,
  telemetryOutboxFile,
  TELEMETRY_QUIT_BUDGET_MS,
  type TelemetryService,
} from '../telemetry';

export {
  adaptLibraryTelemetryOutbox,
  createFileTelemetryOutbox,
  createHttpTelemetryTransport,
  createMemoryTelemetryOutbox,
  createTelemetryScheduler,
  createTelemetryService,
  recordRecoveryOffered,
  recordSessionStarted,
  sessionStartedEvent,
  TELEMETRY_BATCH,
  TELEMETRY_INSTALL_SETTING,
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_OUTBOX_CAP,
  TELEMETRY_QUIT_BUDGET_MS,
  TELEMETRY_VERSION_HEADER,
  telemetryBackoffMs,
  telemetryEndpoint,
  telemetryIngestRouter,
  telemetryOutboxFile,
  telemetryProjectKey,
  telemetryRouter,
  TelemetryServiceToken,
} from '../telemetry';
export type {
  RecoveryOfferedFacts,
  SessionStartedFacts,
  TelemetryOutbox,
  TelemetryScheduler,
  TelemetryService,
  TelemetryServiceOptions,
  TelemetryState,
  TelemetryTransport,
} from '../telemetry';

/**
 * The library outbox when the container has one, otherwise the file outbox.
 * The same service is core's TelemetryToken, which the agent routers record
 * through. `appVersion` is the header (main's app.getVersion()).
 */
export function registerAgentTelemetry(container: Container, appVersion: string): void {
  const dispose = (service: TelemetryService) =>
    service.flush(TELEMETRY_QUIT_BUDGET_MS - 500).finally(() => service.stop());
  if (container.has(LibraryDatabaseToken)) {
    container.factory(
      TelemetryServiceToken,
      ({ settings, clock, db }) =>
        createTelemetryService({
          settings,
          clock,
          outbox: adaptLibraryTelemetryOutbox(createTelemetryOutbox(db)),
          scheduler: createTelemetryScheduler(),
          appVersion,
        }),
      { deps: { settings: SettingsStoreToken, clock: ClockToken, db: LibraryDatabaseToken }, dispose },
    );
  } else {
    container.factory(
      TelemetryServiceToken,
      ({ settings, clock, config }) =>
        createTelemetryService({
          settings,
          clock,
          outbox: createFileTelemetryOutbox(telemetryOutboxFile(config.userData)),
          scheduler: createTelemetryScheduler(),
          appVersion,
        }),
      { deps: { settings: SettingsStoreToken, clock: ClockToken, config: UtilityConfigToken }, dispose },
    );
  }
  container.factory(TelemetryToken, ({ service }) => service, { deps: { service: TelemetryServiceToken } });
}
