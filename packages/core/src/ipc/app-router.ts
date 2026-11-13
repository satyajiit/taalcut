// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's router for the renderer's port, built from APP_ROUTES: namespaces
 * main owns come from `local`, every other one is forwarded to the owning
 * process. The process's client is looked up on every call, so a restarted
 * process is picked up without rebuilding anything.
 */
import type { Context, Router } from '@orpc/server';
import type { Clock } from '../basics/clock';
import {
  APP_ROUTES,
  appContract,
  type AppContract,
  type MainNamespace,
  type UtilityClient,
  type UtilityName,
} from './app-contract';
import type { AnyContractRouter, RpcClient } from './contract';
import { diagnosticsContract, diagnosticsRouter } from './diagnostics-contract';
import { forwardTo } from './forward';

/** The current client of a utility process (main's UtilityHost provides it). */
export type UtilityClients = <P extends UtilityName>(process: P) => UtilityClient<P>;

export type MainRouters<TContext extends Context> = {
  readonly [K in MainNamespace]: Router<AppContract[K], TContext>;
};

export function routeAppContract<TContext extends Context = Record<never, never>>(
  local: MainRouters<TContext>,
  utility: UtilityClients,
): Router<AppContract, TContext> {
  const routes: Record<string, unknown> = {};
  for (const key of Object.keys(APP_ROUTES) as (keyof AppContract)[]) {
    const owner = APP_ROUTES[key];
    if (owner === 'main') {
      routes[key] = local[key as MainNamespace];
      continue;
    }
    const contract: AnyContractRouter = appContract[key];
    // Same key in the owner's contract (test/app-wiring.test.ts checks it at compile time).
    routes[key] = forwardTo(contract, () => {
      const client = utility(owner) as unknown as Readonly<Record<string, RpcClient<AnyContractRouter>>>;
      return client[key] as RpcClient<AnyContractRouter>;
    });
  }
  return routes as Router<AppContract, TContext>;
}

/** Main's diagnostics namespace: answers `main` itself, forwards `agent`, `jobs` and `render`. */
export function mainDiagnosticsRouter<TContext extends Context = Record<never, never>>(
  options: { readonly pid: number; readonly clock: Clock },
  utility: UtilityClients,
): Router<AppContract['diagnostics'], TContext> {
  return {
    main: diagnosticsRouter({ process: 'main', ...options }),
    agent: forwardTo(diagnosticsContract, () => utility('agent').diagnostics),
    jobs: forwardTo(diagnosticsContract, () => utility('jobs').diagnostics),
    render: forwardTo(diagnosticsContract, () => utility('render').diagnostics),
  };
}
