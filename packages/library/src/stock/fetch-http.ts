// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `StockHttp` a composition root injects: the runtime's fetch and nothing
 * else. Nothing in this package constructs it, so a caller that does not pass
 * it cannot reach the network. A failed request is `stock_unavailable` naming
 * only the host (a search URL carries the user's query, a header the key), or
 * `core.cancelled` when the signal fired.
 */
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { StockUnavailable } from '../errors';
import type { StockHttp } from './stock-provider';

export function createFetchStockHttp(): StockHttp {
  return {
    async get(url, headers, signal) {
      const response = await request(url, headers, signal);
      if (!response.ok) return response;
      try {
        const body = new Uint8Array(await response.value.arrayBuffer());
        return ok({ status: response.value.status, headers: headersOf(response.value), body });
      } catch {
        // The connection dropped while the body was read.
        return err(failure(url, signal));
      }
    },
    async stream(url, headers, signal) {
      const response = await request(url, headers, signal);
      if (!response.ok) return response;
      return ok({
        status: response.value.status,
        headers: headersOf(response.value),
        body: chunksOf(response.value.body),
      });
    },
  };
}

async function request(
  url: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): AsyncResult<Response> {
  try {
    return ok(await fetch(url, { headers, signal }));
  } catch {
    // DNS, TLS, a refused connection or an abort: fetch only throws.
    return err(failure(url, signal));
  }
}

function failure(url: string, signal: AbortSignal): TaalcutError {
  if (signal.aborted) return CancelledError();
  return StockUnavailable({ provider: URL.canParse(url) ? new URL(url).hostname : 'unknown' });
}

function headersOf(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function* chunksOf(body: ReadableStream<Uint8Array> | null): AsyncIterable<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  let done = false;
  try {
    while (!done) {
      const next = await reader.read();
      done = next.done;
      if (next.value) yield next.value;
    }
  } finally {
    // The reader stopped early (too large, cancelled): end the transfer instead of draining it.
    // A cancel that fails has nothing left to release.
    if (!done)
      await reader.cancel().then(
        () => undefined,
        () => undefined,
      );
  }
}
