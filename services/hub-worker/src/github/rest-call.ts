// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One GitHub REST call: the installation token, the request, then the body checked with zod. */
import { type z } from 'zod';

import { jsonValue } from '../encoding/json-text';
import { type GitHubResult } from './github-port';

const API = 'https://api.github.com';
export const GITHUB_API_VERSION = '2026-03-10';

export interface RestCallOptions {
  /** The installation token, or why there is none. */
  token: () => Promise<GitHubResult<string>>;
  fetch: typeof fetch;
}

export interface RestRead<T> {
  readonly body?: unknown;
  readonly shape: z.ZodType<T>;
  /** The file's text (`application/vnd.github.raw+json`) rather than JSON. */
  readonly raw?: boolean;
}

export type RestCall = <T>(method: string, path: string, read: RestRead<T>) => Promise<GitHubResult<T>>;

export function createRestCall(options: RestCallOptions): RestCall {
  return async (method, path, read) => {
    const token = await options.token();
    if (!token.ok) return token;
    const response = await send(options.fetch, method, path, token.value, read);
    if (!response) return { ok: false, failure: { kind: 'network' } };
    const text = await response.text();
    if (!response.ok) return { ok: false, failure: { kind: 'status', status: response.status } };
    const parsed = read.shape.safeParse(read.raw ? text : text ? jsonValue(text) : null);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          failure: { kind: 'shape', what: `${method} ${path.replace(/^\/repos\/[^/]+\/[^/]+/, '')}` },
        };
  };
}

/** True when the call failed with one of `statuses`. */
export function isStatus(result: GitHubResult<unknown>, ...statuses: number[]): boolean {
  return !result.ok && result.failure.kind === 'status' && statuses.includes(result.failure.status);
}

async function send(
  fetchImpl: typeof fetch,
  method: string,
  path: string,
  token: string,
  read: RestRead<unknown>,
): Promise<Response | null> {
  try {
    return await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        accept: read.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'taalcut-hub-worker',
        'x-github-api-version': GITHUB_API_VERSION,
      },
      ...(read.body === undefined ? {} : { body: JSON.stringify(read.body) }),
    });
  } catch {
    // fetch rejects only when no response came back (DNS, TLS, reset): the caller reports `network`.
    return null;
  }
}
