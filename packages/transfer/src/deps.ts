// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Clock, EventPayload, ImportSink, TRANSFER_PLATFORMS } from '@taalcut/core';
import type { ProbeResult } from '@taalcut/media';
import type { NetworkInfo } from './network';
import type { ReencodeProbe } from './reencode';

export type TransferPlatform = (typeof TRANSFER_PLATFORMS)[number];

/**
 * What the lan process hands the transfer service.
 * `media.probe` is the package's port onto @taalcut/media: a ProbeResult, the
 * smaller ReencodeProbe, or `{ ok: false }` when nothing could be read.
 */
export interface TransferMedia {
  probe(
    path: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ProbeResult | ReencodeProbe | { readonly ok: false; readonly error?: unknown }>;
}

export interface TransferEvents {
  emit<T extends 'transfer.session' | 'transfer.file'>(type: T, payload: EventPayload<T>): void;
}

export interface TransferLog {
  info(line: string): void;
}

/** Test double for `crypto`. Production uses Node's CSPRNG. */
export interface TransferRandom {
  bytes(n: number): Buffer;
  /** An integer in `[0, max)`. */
  int(max: number): number;
}

export interface PhoneAsset {
  readonly bytes: Uint8Array;
  readonly type: string;
}

/** Exact URL name → bytes. The server never joins a path from the request. */
export type PhoneAssets = Readonly<Record<string, PhoneAsset>>;

export type Reachable = 'yes' | 'blocked' | 'local-network-denied';

export interface TransferDeps {
  /** Desktop reception lasts until explicitly stopped or application shutdown. Other callers retain idle expiry. */
  readonly keepReceptionOpen?: boolean;
  readonly importSink: ImportSink;
  readonly media: TransferMedia;
  readonly events: TransferEvents;
  readonly clock: Clock;
  /** App data `transfer/`: port, devices, upload index. Mode 0600 for the secrets file. */
  readonly stateDir: string;
  readonly phoneAssets: PhoneAssets;
  readonly network: NetworkInfo;
  readonly log?: TransferLog;
  readonly random?: TransferRandom;
  /** Replaces the real `GET /api/ping` self-test. */
  readonly selfTest?: (address: string, port: number) => Promise<Reachable>;
  /**
   * The OS has a switch that keeps apps off the local network (macOS's Local Network privacy, the default). Without
   * one (Linux, Windows) a self-test refused at once is a firewall, `blocked`, never `local-network-denied`.
   */
  readonly localNetworkPrivacy?: boolean;
  /** Tests bind 127.0.0.1. Production leaves this unset. */
  readonly allowLoopback?: boolean;
  /** Free bytes on the staging volume. Defaults to `statfs`. */
  readonly diskFree?: (dir: string) => Promise<number>;
  /**
   * Replaces `http.Server.listen`. Tests use this when the host has only one
   * loopback address. Production leaves this unset.
   */
  readonly bind?: (
    address: string,
    port: number,
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ) => Promise<Server>;
}
