// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createManualClock,
  createMemorySettingsStore,
  TELEMETRY_SETTING,
  type SettingsStore,
  type TelemetryEvent,
} from '@taalcut/core';
import {
  createMemoryTelemetryOutbox,
  createTelemetryService,
  TELEMETRY_INSTALL_SETTING,
  type TelemetryOutbox,
  type TelemetryScheduler,
  type TelemetryService,
  type TelemetryTransport,
} from '../../src/utility/roots/telemetry';

/** Runs the one scheduled callback immediately. No real timer. */
export function fakeScheduler(): TelemetryScheduler & { delay(): number | undefined } {
  let pending: { ms: number; fn: () => void } | undefined;
  return {
    schedule(ms, fn) {
      pending = { ms, fn };
    },
    flush() {
      const due = pending;
      pending = undefined;
      due?.fn();
    },
    stop() {
      pending = undefined;
    },
    delay: () => pending?.ms,
  };
}

export function sessionEvent(): TelemetryEvent {
  return {
    name: 'session.started',
    appVersion: '0.2.0-alpha.3',
    channel: 'alpha',
    osMajor: 15,
    tier: 'recommended',
    locale: 'en',
    profile: 'balanced',
  };
}

export async function allow(settings: SettingsStore, cohort?: string): Promise<void> {
  const written = await settings.set(TELEMETRY_SETTING, {
    enabled: true,
    changedAt: 1,
    ...(cohort ? { cohort } : {}),
  });
  if (!written.ok) throw new Error(written.error.code);
}

export async function installOf(settings: SettingsStore) {
  const got = await settings.get(TELEMETRY_INSTALL_SETTING);
  if (!got.ok) throw new Error(got.error.code);
  return got.value;
}

export interface Harness {
  readonly settings: SettingsStore;
  readonly clock: ReturnType<typeof createManualClock>;
  readonly scheduler: ReturnType<typeof fakeScheduler>;
  readonly outbox: TelemetryOutbox;
  readonly service: TelemetryService;
}

export function harness(options?: {
  readonly endpoint?: string | null;
  readonly outbox?: TelemetryOutbox;
  readonly transport?: TelemetryTransport;
}): Harness {
  const settings = createMemorySettingsStore();
  const clock = createManualClock(1_700_000_000_000);
  const scheduler = fakeScheduler();
  const outbox = options?.outbox ?? createMemoryTelemetryOutbox();
  const endpoint = options?.endpoint === undefined ? 'http://127.0.0.1:9' : options.endpoint;
  const service = createTelemetryService({
    settings,
    clock,
    scheduler,
    outbox,
    appVersion: '1.4.0',
    ...(endpoint === null ? {} : { endpoint }),
    ...(options?.transport ? { transport: options.transport } : {}),
  });
  return { settings, clock, scheduler, outbox, service };
}
