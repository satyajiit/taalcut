// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Routing in main: the renderer has one port, to main. Main serves the app
 * contract; namespaces it owns (theme) have real handlers, and namespaces a
 * utility process owns are forwarded with `forwardTo`. Input is validated in
 * main and again in the utility process; the AbortSignal, streams and
 * TaalcutErrors pass through unchanged.
 */
import { isContractProcedure, type AnyContractRouter, type ContractRouterClient } from '@orpc/contract';
import { implement, type Context, type Router } from '@orpc/server';

type ProcedureCall = (input: unknown, options: { signal?: AbortSignal }) => Promise<unknown>;

function procedureAt(client: unknown, path: readonly string[]): ProcedureCall {
  let target = client;
  for (const key of path) target = (target as Record<string, unknown>)[key];
  return target as ProcedureCall;
}

function build(node: AnyContractRouter, path: readonly string[], client: () => unknown): unknown {
  if (isContractProcedure(node)) {
    return implement(node).handler(({ input, signal }) => procedureAt(client(), path)(input, { signal }));
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [
      key,
      build(child as AnyContractRouter, [...path, key], client),
    ]),
  );
}

/**
 * A router that implements `contract` by calling the same procedures on
 * `client()`. `client` is a function so a restarted utility process can be
 * swapped in without rebuilding main's router.
 */
export function forwardTo<C extends AnyContractRouter, TContext extends Context = Record<never, never>>(
  contract: C,
  client: () => ContractRouterClient<C>,
): Router<C, TContext> {
  return build(contract, [], client) as Router<C, TContext>;
}
