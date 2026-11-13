// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every utility-process entry does: wait for main's UTILITY_CONNECT
 * message, compose the process from the config it carries (once), and serve
 * the process's contract on the first port that came with it; the second
 * port reaches main's services (MAIN_SERVICE_CONTRACTS). Errors keep their
 * developer detail on the way to main, which drops it before a page sees
 * it. A process that can't compose exits non-zero, and main's supervisor
 * restarts it with backoff. On SIGTERM (main stopping it) the container is
 * disposed first.
 */
import {
  serveRpc,
  type AnyContractRouter,
  type Container,
  type PortLike,
  type RpcRouter,
  type UtilityName,
} from '@taalcut/core';
import { disableOrtTelemetry } from '../shared/ort-telemetry';
import { isUtilityConnectMessage, type UtilityConfig } from '../shared/rpc-ipc';

export interface UtilityContext {
  readonly caller: 'main';
}

export interface UtilityRoot {
  readonly container: Container;
  /** Implements UTILITY_CONTRACTS[name]. */
  readonly router: RpcRouter<AnyContractRouter, UtilityContext>;
  /** Starts background work (the job engine) once composed; a rejection is fatal like a failed compose. */
  start?(): Promise<void>;
  /**
   * Stops that work before the container disposes anything. The container disposes newest first, and a service
   * made on first use (the audio runtime, at the first audio job) is newer than the job engine: without this, at
   * quit it closed under the engine's running jobs, which then failed for good (audio.engine_unavailable).
   */
  stop?(): Promise<void>;
}

/** `main`: the port to main's services, when main sent one. */
export type ComposeUtility = (
  config: UtilityConfig,
  main: PortLike | undefined,
) => UtilityRoot | Promise<UtilityRoot>;

/** The part of Electron's process.parentPort used here. */
export interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown; ports: readonly PortLike[] }) => void): unknown;
}

export interface UtilityHandle {
  /** Resolves once composed (after the first connect message). */
  readonly root: Promise<UtilityRoot> | undefined;
  dispose(): Promise<void>;
}

export function runUtility(
  name: UtilityName,
  compose: ComposeUtility,
  parent: ParentPortLike,
  onFatal: (error: unknown) => void = (error) => {
    console.error(`[${name}] could not start`, error);
    process.exit(1);
  },
): UtilityHandle {
  // Before anything can load ONNX Runtime: its built-in telemetry stays off in every utility process.
  disableOrtTelemetry();
  if (__TAALCUT_FLAVOUR__ === 'test') listenForTestCrash(parent);
  // Test builds: this process's network recorder, installed before it composes (P3-B10).
  const testReady =
    __TAALCUT_FLAVOUR__ === 'test'
      ? import('../shared/test-network-log').then(({ installNetworkLog }) => installNetworkLog(name))
      : Promise.resolve();
  let root: Promise<UtilityRoot> | undefined;
  parent.on('message', (event) => {
    const [port, services] = event.ports;
    if (!isUtilityConnectMessage(event.data) || event.data.config.process !== name || !port) return;
    const config = event.data.config;
    root ??= testReady.then(async () => {
      const ready = await compose(config, services);
      await ready.start?.();
      return ready;
    });
    root.then(
      (ready) => void serveRpc(ready.router, port, { context: { caller: 'main' }, exposeDetail: true }),
      onFatal,
    );
  });
  return {
    get root() {
      return root;
    },
    async dispose() {
      const ready = await root?.catch(() => undefined);
      await ready?.stop?.();
      await ready?.container.dispose();
    },
  };
}

/** `--taalcut-test-crash=agent|jobs`: main posts this after the window is shown. */
function listenForTestCrash(parent: ParentPortLike): void {
  parent.on('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if ((data as { type?: unknown }).type !== 'taalcut-test-crash') return;
    process.crash();
  });
}

/** Disposes the container on SIGTERM (utilityProcess.kill), then exits; gives up after `graceMs`. */
export function exitOnTerminate(handle: UtilityHandle, graceMs = 2000): void {
  process.once('SIGTERM', () => {
    setTimeout(() => process.exit(0), graceMs).unref();
    void handle.dispose().finally(() => process.exit(0));
  });
}
