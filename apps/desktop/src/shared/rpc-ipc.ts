// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The only raw IPC left between a window and main: the page asks for its
 * port, and main sends it (see connectToMain in @taalcut/core). Every other
 * call goes over that port as oRPC. Main also hands each utility process its
 * port with UTILITY_CONNECT. No Electron and no Node here: main, preload and
 * the utility processes all import it.
 */
import type { UtilityName } from '@taalcut/core';

export const RPC_IPC = {
  /** page → main (ipcRenderer.send), with the request's nonce. */
  connect: 'taalcut:rpc-connect',
  /** main → preload (WebFrameMain.postMessage), with the nonce and one port. */
  port: 'taalcut:rpc-port',
} as const;

/** connectToMain's nonces are ULIDs; anything else is dropped before it reaches main's logic. */
export function isNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

/**
 * main → utility process (UtilityProcess.postMessage), with two ports: serve
 * your contract (UTILITY_CONTRACTS) on the first; call main's services
 * (MAIN_SERVICE_CONTRACTS) on the second.
 */
export const UTILITY_CONNECT = 'taalcut:connect';

/** What a utility process needs from main to compose itself. */
export interface UtilityConfig {
  readonly process: UtilityName;
  /** The library database, already migrated by main. */
  readonly dbPath: string;
  readonly userData: string;
  /** The app's Resources folder (sidecar binaries in bin/). */
  readonly resourcesPath: string;
  /** A packaged build: only bundled, LGPL sidecars; no development fallbacks. */
  readonly packaged: boolean;
  /** The signed component manifest (shared/component-manifest.ts). */
  readonly componentManifest: string;
  /** Main's app.getVersion(), the telemetry header. Omitted in tests. */
  readonly appVersion?: string;
  /** The mcp process only: the loopback port to listen on (MCP_PORT_SETTING as main read it). */
  readonly mcpPort?: number;
}

export interface UtilityConnectMessage {
  readonly type: typeof UTILITY_CONNECT;
  readonly config: UtilityConfig;
}

export function isUtilityConnectMessage(data: unknown): data is UtilityConnectMessage {
  const message = data as Partial<UtilityConnectMessage> | null;
  const config = message?.config as Partial<UtilityConfig> | undefined;
  return (
    typeof message === 'object' &&
    message?.type === UTILITY_CONNECT &&
    typeof config?.process === 'string' &&
    typeof config.dbPath === 'string' &&
    typeof config.userData === 'string' &&
    typeof config.resourcesPath === 'string' &&
    typeof config.packaged === 'boolean' &&
    typeof config.componentManifest === 'string'
  );
}
