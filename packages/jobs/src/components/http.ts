// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The network seam (an injected fetch) and small HTTP parsing helpers. */

export interface FetchInit {
  readonly method: 'GET';
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
  /** download.ts follows redirects itself, checking each Location before it connects. */
  readonly redirect: 'manual';
}

/**
 * Anything shaped like the global fetch (undici in Node 24). The desktop app
 * passes `globalThis.fetch` (or Electron's net.fetch); tests pass the global
 * fetch pointed at a local server, or a fake.
 */
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

export interface ContentRange {
  readonly start: number;
  readonly end: number;
  /** undefined when the server sent '*'. */
  readonly total: number | undefined;
}

/** Parses 'bytes 100-199/1000'. */
export function parseContentRange(value: string | null): ContentRange | undefined {
  const match = value ? /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim()) : null;
  if (!match) return undefined;
  const [, start, end, total] = match as unknown as [string, string, string, string];
  return { start: Number(start), end: Number(end), total: total === '*' ? undefined : Number(total) };
}

export function contentLength(headers: Headers): number | undefined {
  const value = headers.get('content-length');
  return value !== null && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined;
}

/** Statuses worth retrying on the same mirror. Every other 4xx moves on to the next mirror. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

/** Developer detail for a thrown network error. undici hides the useful part in `cause`. */
export function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = cause.cause instanceof Error ? ` (${describeCause(cause.cause)})` : '';
  const code = 'code' in cause && typeof cause.code === 'string' ? ` [${cause.code}]` : '';
  return `${cause.name}: ${cause.message}${code}${inner}`;
}
