// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What one item's import needs from its run, and how it ends. */
import type { Clock, ImportSink, TransferDeviceId } from '@taalcut/core';
import type { TransferMedia } from '../deps';
import type { BridgeKind, BridgeSession } from './bridge';
import type { RunFreshness } from './ledger';
import type { RunRecord } from './run-store';

export type PauseReason = NonNullable<RunRecord['pauseReason']>;

export interface ItemControl {
  pauseReason(): PauseReason | null;
  cancelled(): boolean;
}

export interface ItemDeps {
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly media: TransferMedia;
  readonly sink: ImportSink;
  readonly clock: Clock;
  readonly log?: { info(line: string): void };
  readonly deviceId: TransferDeviceId;
  readonly bridge: BridgeKind;
  readonly iCloudPhotos: boolean;
  readonly session: BridgeSession;
  /** The ledger and the library's assets, read once for the run's pump. */
  readonly freshness: RunFreshness;
  readonly signal: AbortSignal;
  readonly control: ItemControl;
  readonly onBytes: (received: number) => void;
  /** The item moved: show it now; the run file follows (run-persist). */
  readonly touch: () => void;
}

export type StepResult =
  | { readonly status: 'paused'; readonly reason: PauseReason }
  | { readonly status: 'cancelled' }
  | { readonly status: 'done' };
