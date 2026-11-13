// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-process stand-ins for utility processes: the host "forks" a FakeUtility,
 * which runs the real utility runtime (runUtility) and composition root on
 * the port main hands it. Node's MessageChannel stands in for
 * MessageChannelMain. crash() fires the exit the supervisor would see, with
 * the port still open, as when a process is killed before its port notices.
 */
import { EventEmitter } from 'node:events';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { ok, serveRpc, type PortLike, type UtilityName } from '@taalcut/core';
import { mainServicesRouter } from '../../src/main/composition/main-routers';
import { UtilityHost } from '../../src/main/rpc/utility-host';
import { utilityProcessTable } from '../../src/main/utility/process-table';
import type { ProcessSpec } from '../../src/main/utility/supervisor';
import { runUtility, type ComposeUtility, type UtilityHandle } from '../../src/utility/runtime';
import { testConfig } from './roots';

const noCredentials = {
  get: async () => ok(undefined),
  invalidate: () => undefined,
  statuses: async () => ok([]),
};

const open: MessagePort[] = [];

export function closeAllPorts(): void {
  for (const port of open.splice(0)) port.close();
}

export function nodeChannel(): { local: PortLike; remote: MessagePort } {
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  return { local: port1, remote: port2 };
}

let nextPid = 5000;

export class FakeUtility {
  readonly pid = (nextPid += 1);
  readonly handle: UtilityHandle;
  fatal: unknown;
  private readonly parent = new EventEmitter();
  private exitListener: ((code: number) => void) | undefined;

  constructor(
    readonly spec: ProcessSpec,
    compose: ComposeUtility,
  ) {
    this.handle = runUtility(
      spec.name as UtilityName,
      compose,
      { on: (event, listener) => this.parent.on(event, listener) },
      (error) => (this.fatal = error),
    );
  }

  postMessage(message: unknown, transfer: MessagePort[]): void {
    this.parent.emit('message', { data: message, ports: transfer });
  }

  kill(): boolean {
    queueMicrotask(() => this.crash(0));
    return true;
  }

  once(_event: 'exit', listener: (code: number) => void): this {
    this.exitListener = listener;
    return this;
  }

  crash(code = 1): void {
    const listener = this.exitListener;
    this.exitListener = undefined;
    listener?.(code);
  }
}

/**
 * A host whose processes run `compose(name)` in this process, restarting
 * after 10 ms. Main serves the agent its services: no credentials, and the
 * job runner forwarded to the jobs process, as in the app.
 */
export function fakeHost(compose: (name: string) => ComposeUtility, dbPath = ':memory:') {
  const children: FakeUtility[] = [];
  const host: UtilityHost<MessagePort> = new UtilityHost<MessagePort>({
    specs: utilityProcessTable('/out/utility/stub.mjs'),
    fork: (spec) => {
      const child = new FakeUtility(spec, compose(spec.name));
      children.push(child);
      return child;
    },
    createChannel: nodeChannel,
    config: (process) => ({ ...testConfig(process, dbPath) }),
    serveMainServices: (process, port) =>
      serveRpc(mainServicesRouter(process, { broker: noCredentials, host }), port, {
        context: {},
        exposeDetail: true,
      }),
    backoff: { initialMs: 10, factor: 2, maxMs: 100, stableAfterMs: 60_000 },
  });
  return { host, children, latest: (name: string) => children.filter((c) => c.spec.name === name).at(-1) };
}
