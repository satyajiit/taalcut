// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Serves an oRPC router on a MessagePort. Every error a procedure throws, or a
 * stream yields, leaves as a TaalcutError (see errors.ts), so a bad payload is
 * a typed reply, never a crash. Unless `exposeDetail` is set (a utility
 * process serving main, or main serving a utility process), no `detail`
 * leaves: not on a thrown error, and not on an error inside an output or a
 * streamed item. A window's port is served without it.
 */
import type { AnyContractRouter } from '@orpc/contract';
import type { Context, Router } from '@orpc/server';
import { RPCHandler } from '@orpc/server/message-port';
import { toServerRpcError, withoutDetails, type ServerErrorOptions } from './errors';
import { isAsyncIterator, mapIteratorErrors } from './iterators';
import { adaptPort, type PortLike } from './port';

export interface RpcServer {
  readonly closed: boolean;
  onClose(listener: () => void): () => void;
  /** Stops serving: in-flight handlers see their AbortSignal fire. */
  close(): void;
}

function mapServerErrors(options: ServerErrorOptions) {
  const map = (cause: unknown) => toServerRpcError(cause, options);
  const value = options.exposeDetail ? undefined : withoutDetails;
  return async ({ next }: { next: () => Promise<unknown> }): Promise<unknown> => {
    try {
      const output = await next();
      if (isAsyncIterator(output)) return mapIteratorErrors(output, map, value);
      return value ? value(output) : output;
    } catch (cause) {
      throw map(cause);
    }
  };
}

/**
 * `context` is fixed per connection and reaches every handler, e.g.
 * `{ caller: 'renderer', windowId }` in main. Errors, in a reply or inside
 * one, leave without their `detail` unless `exposeDetail` is set (process to
 * process ports only).
 */
export function serveRpc<TContext extends Context>(
  router: Router<AnyContractRouter, TContext>,
  port: PortLike,
  options: { readonly context: TContext } & ServerErrorOptions,
): RpcServer {
  const adapter = adaptPort(port);
  // Typed against the caller's TContext above; oRPC's option types don't resolve for a generic context.
  const handler = new RPCHandler<Context>(router as Router<AnyContractRouter, Context>, {
    clientInterceptors: [mapServerErrors({ exposeDetail: options.exposeDetail ?? false })],
  });
  handler.upgrade(adapter.port, { context: options.context });
  return {
    get closed() {
      return adapter.closed;
    },
    onClose: (listener) => adapter.onClose(listener),
    close: () => adapter.close(),
  };
}
