// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TransferDeps, TransferRandom } from '../deps';
import type { HttpHost } from '../http/dispatch';
import type { DeviceStore } from '../pairing/devices';
import type { RateLimiter } from '../pairing/rate';
import type { UploadIndex } from '../store/uploads';
import type { LiveFile, LiveSession, StopReason } from './live';

export interface HandoffPump {
  enqueue(file: LiveFile, dir: string): void;
  drained(): Promise<void>;
}

/** Mutable session state shared by the HTTP host, tus hooks, and the service methods. */
export interface SessionBox {
  readonly deps: TransferDeps;
  readonly random: TransferRandom;
  readonly devices: DeviceStore;
  readonly uploads: UploadIndex;
  readonly rates: RateLimiter;
  readonly handoff: HandoffPump;
  host: HttpHost;
  current: LiveSession | null;
  stop(session: LiveSession, reason: StopReason): Promise<void>;
  armIdle(session: LiveSession): void;
  emitFile(file: LiveFile, force: boolean): void;
  emitSession(session: LiveSession, pairing: boolean): void;
  diskFree(dir: string): Promise<number>;
  log(line: string): void;
}
