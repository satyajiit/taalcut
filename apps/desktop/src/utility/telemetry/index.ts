// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { resolveTelemetryEndpoint, telemetryEndpoint, usableTelemetryEndpoint } from './endpoint';
export { recordRecoveryOffered, recordSessionStarted, sessionStartedEvent } from './events';
export type { RecoveryOfferedFacts, SessionStartedFacts } from './events';
export {
  ensureTelemetryInstall,
  forgetTelemetryInstall,
  TELEMETRY_INSTALL_SETTING,
  telemetryProjectKey,
} from './install';
export type { TelemetryInstall } from './install';
export { createFileTelemetryOutbox, telemetryOutboxFile, unreadableOutboxFile } from './file-outbox';
export { adaptLibraryTelemetryOutbox, createMemoryTelemetryOutbox, TELEMETRY_OUTBOX_CAP } from './outbox';
export type { TelemetryOutbox, TelemetryOutboxRow } from './outbox';
export { telemetryIngestRouter, telemetryRouter } from './routers';
export {
  createTelemetryScheduler,
  TELEMETRY_BATCH,
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_QUIT_BUDGET_MS,
  telemetryBackoffMs,
} from './scheduler';
export type { TelemetryScheduler } from './scheduler';
export { createTelemetryService, TelemetryServiceToken } from './service';
export type { TelemetryService, TelemetryServiceOptions, TelemetryState } from './service';
export { createHttpTelemetryTransport, TELEMETRY_VERSION_HEADER } from './transport';
export type { TelemetryTransport } from './transport';
