// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Wraps the fetch pi-ai uses for one call (pi-ai's `fetch` option) to measure
 * what went over the wire for the cloud-call log, and to see HTTP status and
 * Retry-After even when the provider SDK turns them into an error string.
 */
import { resetFromHeaders } from '../limits/reset-headers';

export type FetchFn = typeof globalThis.fetch;

export interface HttpMeter {
  readonly fetch: FetchFn;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  /** Status of the last response, if any arrived. */
  readonly lastStatus?: number;
  /** Retry-After of the last response, in milliseconds. */
  readonly retryAfterMs?: number;
  /** When the provider's limit lifts (epoch ms), from its reset headers on the last response (G8). */
  readonly resetAt?: number;
  readonly requests: number;
}

export function createHttpMeter(base: FetchFn): HttpMeter {
  let bytesSent = 0;
  let bytesReceived = 0;
  let requests = 0;
  let lastStatus: number | undefined;
  let retryAfterMs: number | undefined;
  let resetAt: number | undefined;

  const metered: FetchFn = async (input, init) => {
    requests += 1;
    bytesSent += bodySize(init?.body);
    const response = await base(input, init);
    lastStatus = response.status;
    retryAfterMs = parseRetryAfter(response.headers);
    // Only a refusal's reset matters: a 200 carries the window's reset too, which isn't a limit met.
    resetAt =
      response.status === 429 || response.status === 402
        ? resetFromHeaders(response.headers, Date.now())
        : undefined;
    if (!response.body) return response;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesReceived += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    return new Response(response.body.pipeThrough(counter), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    fetch: metered,
    get bytesSent() {
      return bytesSent;
    },
    get bytesReceived() {
      return bytesReceived;
    },
    get lastStatus() {
      return lastStatus;
    },
    get retryAfterMs() {
      return retryAfterMs;
    },
    get resetAt() {
      return resetAt;
    },
    get requests() {
      return requests;
    },
  };
}

function bodySize(body: RequestInit['body']): number {
  if (body === null || body === undefined) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof Blob) return body.size;
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString(), 'utf8');
  // Streams and form data have no cheap size; providers send JSON strings, so this is rare.
  return 0;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Number(ms);
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
