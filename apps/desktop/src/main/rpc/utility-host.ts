// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's side of the utility processes: the supervisor forks them, and this
 * gives each fork a fresh MessagePort and an oRPC client on it, plus a
 * second port on which main serves the process its services (credentials,
 * the job runner; MAIN_SERVICE_CONTRACTS). When the
 * supervisor reports an exit, the client closes as 'peer-exited', so calls in
 * flight (and calls made before the restart) reject with
 * core.process_restarted. When the process is forked again, a new client
 * replaces it; forwardTo reads `client(name)` on every call, and
 * onConnected listeners (main's event bridge) subscribe again.
 * Electron is injected (fork, createChannel) so this is unit-tested.
 */
import {
  connectRpc,
  UTILITY_CONTRACTS,
  type AnyContractRouter,
  type PortLike,
  type RpcConnection,
  type UtilityClient,
  type UtilityName,
} from '@taalcut/core';
import { UTILITY_CONNECT, type UtilityConfig, type UtilityConnectMessage } from '../../shared/rpc-ipc';
import type { UtilityProcessSpec } from '../utility/process-table';
import {
  ProcessSupervisor,
  type ProcessSpec,
  type SupervisedChild,
  type SupervisorOptions,
} from '../utility/supervisor';

/** The part of Electron's UtilityProcess the host uses. `Remote` is MessagePortMain. */
export interface UtilityChild<Remote> extends SupervisedChild {
  postMessage(message: unknown, transfer: Remote[]): void;
}

export interface UtilityHostDeps<Remote> extends Omit<SupervisorOptions, 'fork'> {
  readonly specs: readonly UtilityProcessSpec[];
  readonly fork: (spec: ProcessSpec) => UtilityChild<Remote>;
  /** new MessageChannelMain(): `local` stays in main, `remote` goes to the child. */
  readonly createChannel: () => { readonly local: PortLike; readonly remote: Remote };
  readonly config: (process: UtilityName) => UtilityConfig;
  /** Serves main's services to the process (MAIN_SERVICE_CONTRACTS) on its second port. */
  readonly serveMainServices?: (process: UtilityName, port: PortLike) => { close(): void };
}

type AnyConnection = RpcConnection<AnyContractRouter>;

/** A port nobody answers: the client of a process that hasn't started yet. */
const deadPort: PortLike = { postMessage: () => undefined, on: () => undefined };

export class UtilityHost<Remote = unknown> {
  readonly supervisor: ProcessSupervisor;
  private readonly connections = new Map<UtilityName, AnyConnection>();
  private readonly services = new Map<UtilityName, { close(): void }>();
  private readonly listeners = new Set<(process: UtilityName) => void>();

  constructor(private readonly deps: UtilityHostDeps<Remote>) {
    this.supervisor = new ProcessSupervisor({ ...deps, fork: (spec) => this.forkAndConnect(spec) });
    this.supervisor.on((event) => {
      if (event.type !== 'exited') return;
      this.connections.get(event.name as UtilityName)?.close('peer-exited');
      this.services.get(event.name as UtilityName)?.close();
    });
  }

  /** Starts the processes that run from launch (agent, jobs). */
  startEager(): void {
    for (const spec of this.deps.specs) if (spec.eager) this.supervisor.start(spec);
  }

  /** Starts an on-demand process (render, LAN). Does nothing if it is running. */
  start(process: UtilityName): void {
    const spec = this.deps.specs.find((candidate) => candidate.name === process);
    if (spec) this.supervisor.start(spec);
  }

  stop(process: UtilityName): Promise<void> {
    return this.supervisor.stop(process);
  }

  stopAll(): Promise<void> {
    return this.supervisor.stopAll();
  }

  /** The current client. Before the first start, and between an exit and the restart, calls reject with core.process_restarted. */
  client<P extends UtilityName>(process: P): UtilityClient<P> {
    let connection = this.connections.get(process);
    if (!connection) {
      connection = connectRpc(UTILITY_CONTRACTS[process], deadPort, { peer: process });
      connection.close('peer-exited');
      this.connections.set(process, connection);
    }
    return connection.client as UtilityClient<P>;
  }

  /** Called each time a process gets a new connection (first start and every restart). */
  onConnected(listener: (process: UtilityName) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private forkAndConnect(spec: ProcessSpec): SupervisedChild {
    const process = spec.name as UtilityName;
    const child = this.deps.fork(spec);
    const { local, remote } = this.deps.createChannel();
    const back = this.deps.createChannel();
    const message: UtilityConnectMessage = { type: UTILITY_CONNECT, config: this.deps.config(process) };
    try {
      child.postMessage(message, [remote, back.remote]);
    } catch (cause) {
      child.kill();
      throw cause;
    }
    this.connections.get(process)?.close('peer-exited');
    this.connections.set(process, connectRpc(UTILITY_CONTRACTS[process], local, { peer: process }));
    this.services.get(process)?.close();
    const served = this.deps.serveMainServices?.(process, back.local);
    if (served) this.services.set(process, served);
    else this.services.delete(process);
    for (const listener of [...this.listeners]) listener(process);
    return child;
  }
}
