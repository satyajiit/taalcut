// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the request pipeline refuses a request: the status, an optional JSON-RPC error without an id, and, for a
 * request refused before its body was read, a short linger that reads and drops the rest so a body sent slowly
 * can't hold the socket (security review SB-31, SB-43).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Rejection } from './http-guard';

export function jsonRpcError(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } });
}

/** How long the unread body of a refused request is read and dropped before its socket closes. */
const LINGER_MS = 1_000;

/**
 * After a refusal sent before the body was read: what the client still sends is read and dropped (closing at once
 * would answer its writes with a reset, which can lose the refusal itself), and a body that hasn't ended within
 * LINGER_MS loses the socket, so a body sent slowly can't hold it.
 */
function dropUnreadBody(req: IncomingMessage): void {
  if (req.complete) return;
  const timer = setTimeout(() => req.socket.destroy(), LINGER_MS);
  timer.unref();
  // The socket outlives the request on a kept-alive connection: its listener goes when the body has ended.
  const stop = (): void => {
    clearTimeout(timer);
    req.off('end', stop);
    req.socket.off('close', stop);
  };
  req.once('end', stop);
  req.socket.once('close', stop);
  req.resume();
}

/** Sends the refusal and returns its status. `unread`: the request's body may not have been read. */
export function reject(res: ServerResponse, rejection: Rejection, unread = false): number {
  res.writeHead(rejection.status, {
    ...(rejection.body ? { 'content-type': 'application/json' } : {}),
    ...rejection.headers,
  });
  res.end(rejection.body ?? '');
  if (unread) dropUnreadBody(res.req);
  return rejection.status;
}

/** No session holds this bearer (none, unknown, revoked or expired): no OAuth hints, so no client starts discovery. */
export const UNKNOWN_BEARER: Rejection = {
  status: 401,
  body: jsonRpcError(-32001, 'This Taalcut connection was revoked.'),
};

export function tooManyRequests(retryAfterSeconds: number): Rejection {
  return {
    status: 429,
    headers: { 'retry-after': String(retryAfterSeconds) },
    body: jsonRpcError(-32000, 'Too many requests'),
  };
}
