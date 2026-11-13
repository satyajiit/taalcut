// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Offline catalogue refresh answers each request from one exact stored interaction, ignoring only the
 * recorder's variable prompt fields and tool offers. Appended repairs need not be chronological. Missing,
 * ambiguous or reused identities fail; no response is guessed and no model is called.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { FetchFn } from '@taalcut/models';

interface StoredResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly chunks: readonly string[];
}

interface StoredRequest {
  readonly method: string;
  readonly url: string;
  readonly body: Record<string, unknown> | null;
}

const IGNORED = new Set([
  'tools',
  'prompt_cache_key',
  'metadata',
  'user',
  'session_id',
  'system',
  'messages',
]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** The recorder's stable identity, excluding offers being refreshed but retaining ask/turn tags. */
export function storedIdentity(request: StoredRequest): string {
  const body = Object.fromEntries(Object.entries(request.body ?? {}).filter(([key]) => !IGNORED.has(key)));
  return JSON.stringify(canonical({ method: request.method, url: request.url, body }));
}

/** Whether record mode answers from the committed cassettes instead of the stand-in. */
export const recordsFromCassettes = (): boolean => process.env.TAALCUT_RECORD_UPSTREAM === 'cassette';

/** The responses stored at `path`, one use per uniquely identified request. */
export function storedUpstream(path: string): FetchFn {
  const tape = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as {
        interactions: { request: StoredRequest; response: StoredResponse }[];
      })
    : { interactions: [] };
  const identities = tape.interactions.map((row) => storedIdentity(row.request));
  const used = new Set<number>();
  return async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as StoredRequest['body']) : null;
    const identity = storedIdentity({ method: method.toUpperCase(), url, body });
    const matches = identities.flatMap((entry, index) => (entry === identity ? [index] : []));
    const index = matches[0];
    if (matches.length !== 1 || index === undefined || used.has(index)) {
      const message = `${path}: missing, ambiguous or already consumed stored request`;
      const body = { type: 'error', error: { type: 'cassette_miss', message } };
      return new Response(JSON.stringify(body), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    used.add(index);
    const response = tape.interactions[index]!.response;
    return new Response(response.chunks.length > 0 ? response.chunks.join('') : null, {
      status: response.status,
      headers: response.headers,
    });
  };
}
