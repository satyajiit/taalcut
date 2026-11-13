// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's one client of main's services (MAIN_SERVICE_CONTRACTS
 * .jobs) per port: render's export jobs reach the render worker through it,
 * vision's descriptions the agent's background models. Every wiring file asks
 * here, so the port has a single RPC client on it.
 */
import { connectRpc, MAIN_SERVICE_CONTRACTS, type PortLike, type RpcClient } from '@taalcut/core';

type MainServices = RpcClient<typeof MAIN_SERVICE_CONTRACTS.jobs>;

const clients = new WeakMap<PortLike, MainServices>();

export function mainServices(port: PortLike | undefined): MainServices | undefined {
  if (!port) return undefined;
  let client = clients.get(port);
  if (!client) {
    client = connectRpc(MAIN_SERVICE_CONTRACTS.jobs, port, { peer: 'main' }).client;
    clients.set(port, client);
  }
  return client;
}
