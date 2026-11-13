// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A namespace a process must serve (its contract names it) before the work
 * package that implements it has landed. Every procedure answers
 * `core.not_implemented` with the feature's name, so the app starts, routes
 * and reports clearly instead of failing to compile or hanging. A composition
 * root replaces it with the real router when the owning package lands.
 */
import { isContractProcedure, type AnyContractRouter } from '@orpc/contract';
import { implement, type Context, type Router } from '@orpc/server';
import { NotImplementedError } from '../basics/errors';
import type { AsyncResult } from '../basics/result';
import { toRpcError, unwrapRpc } from './errors';

/**
 * A handler for one procedure whose owning package hasn't implemented it yet: it fails with
 * `core.not_implemented` (`params.feature`), for a stream as for a call.
 */
export function notServed(feature: string): () => never {
  return () => {
    throw toRpcError(NotImplementedError({ feature }));
  };
}

function build(node: AnyContractRouter, feature: string): unknown {
  if (isContractProcedure(node)) return implement(node).handler(notServed(feature));
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, build(child as AnyContractRouter, feature)]),
  );
}

/** A router for `contract` whose every procedure fails with `core.not_implemented` (`params.feature`). */
export function notServedRouter<C extends AnyContractRouter, TContext extends Context = Record<never, never>>(
  contract: C,
  feature: string,
): Router<C, TContext> {
  return build(contract, feature) as Router<C, TContext>;
}

/**
 * In a handler, for a procedure added to a namespace before its owning package implements it: the service's
 * optional method, called with `args` and unwrapped; `core.not_implemented` (`params.feature`) while the method
 * is absent. Pass the method bound to its service (`service.gaps?.bind(service)`).
 */
export async function callOptional<A extends unknown[], T>(
  feature: string,
  method: ((...args: A) => AsyncResult<T>) | undefined,
  ...args: A
): Promise<T> {
  if (!method) throw toRpcError(NotImplementedError({ feature }));
  return unwrapRpc(await method(...args));
}
