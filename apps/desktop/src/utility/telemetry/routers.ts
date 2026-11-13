// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.telemetry for a window, and telemetryIngest for every other
 * process. The window contract already refuses events outside
 * RENDERER_TELEMETRY_EVENTS; ingest accepts the whole catalogue. The handler
 * waits until the event is queued or dropped, so state() after record() agrees.
 */
import { implementContract, telemetryContract, telemetryIngestContract, type ProjectId } from '@taalcut/core';
import type { TelemetryService } from './service';

function recordInput(
  service: TelemetryService,
  event: Parameters<TelemetryService['record']>[0],
  projectId?: ProjectId,
) {
  service.record(event, projectId === undefined ? undefined : { projectId });
  return service.settled();
}

export function telemetryRouter(service: TelemetryService) {
  const os = implementContract(telemetryContract);
  return os.router({
    state: os.state.handler(() => service.state()),
    record: os.record.handler(({ input }) => recordInput(service, input.event, input.projectId)),
  });
}

export function telemetryIngestRouter(service: TelemetryService) {
  const os = implementContract(telemetryIngestContract);
  return os.router({
    record: os.record.handler(({ input }) => recordInput(service, input.event, input.projectId)),
  });
}
