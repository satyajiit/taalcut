// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A typed oRPC client over a MessagePort. Calls take an AbortSignal
 * (`client.x(input, { signal })`) that cancels the handler on the other side.
 * When the port closes, pending and later calls fail fast with
 * `core.process_restarted` (the other process went away) or `core.cancelled`
 * (we closed it), never hang.
 */
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import type { AnyContractRouter, ContractRouterClient } from '@orpc/contract';
import { CancelledError, ProcessRestartedError } from '../basics/errors';
import { toRpcError } from './errors';
import { isAsyncIterator, mapIteratorErrors } from './iterators';
import { adaptPort, type CloseReason, type PortLike } from './port';

export interface RpcConnection<C extends AnyContractRouter> {
  readonly client: ContractRouterClient<C>;
  readonly closed: boolean;
  onClose(listener: () => void): () => void;
  /**
   * Fails pending and later calls: with core.cancelled by default, or with
   * core.process_restarted for 'peer-exited' (main calls that when the
   * supervisor reports the process gone, before the port itself notices).
   */
  close(reason?: CloseReason): void;
}

export interface ConnectRpcOptions {
  /** The process on the other end ('agent', 'jobs', 'main'), named in ProcessRestarted errors. */
  readonly peer?: string;
}

/** `contract` is only for type inference; the server validates everything. */
export function connectRpc<C extends AnyContractRouter>(
  _contract: C,
  port: PortLike,
  options: ConnectRpcOptions = {},
): RpcConnection<C> {
  const adapter = adaptPort(port);
  const closedError = () =>
    toRpcError(
      adapter.closedLocally
        ? CancelledError(undefined, { detail: 'IPC connection closed' })
        : ProcessRestartedError({ process: options.peer ?? 'unknown' }),
    );
  const link = new RPCLink({
    port: adapter.port,
    interceptors: [
      async ({ next, signal }) => {
        if (adapter.closed) throw closedError();
        // oRPC rejects an aborted stream with an internal queue error; name it.
        const mapError = (cause: unknown): unknown =>
          signal?.aborted ? toRpcError(CancelledError()) : adapter.closed ? closedError() : cause;
        try {
          const output = await next();
          return isAsyncIterator(output) ? mapIteratorErrors(output, mapError) : output;
        } catch (cause) {
          throw mapError(cause);
        }
      },
    ],
  });
  const client: ContractRouterClient<C> = createORPCClient(link);
  return {
    client,
    get closed() {
      return adapter.closed;
    },
    onClose: (listener) => adapter.onClose(listener),
    close: (reason) => adapter.close(reason),
  };
}
