// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Serves a router over a worker_threads MessageChannel and returns a typed client, as a process boundary does. */
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { connectRpc, serveRpc, type AnyContractRouter, type RpcClient, type RpcRouter } from '@taalcut/core';
import { afterEach } from 'vitest';

const open: MessagePort[] = [];

afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

export function serveForTest<C extends AnyContractRouter>(
  contract: C,
  router: RpcRouter<C, Record<never, never>>,
): RpcClient<C> {
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  serveRpc(router, port1, { context: {} });
  return connectRpc(contract, port2, { peer: 'agent' }).client;
}
