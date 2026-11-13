// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A WireCall as fetch's url and init: the query, `xi-api-key`, and a JSON or multipart body. */
import type { WireCall } from './wire-types';

export interface WireRequest {
  readonly url: string;
  readonly init: RequestInit;
}

export function wireRequest(baseUrl: string, call: WireCall, key: string): WireRequest {
  const url = new URL(call.path, baseUrl);
  for (const [name, value] of Object.entries(call.query ?? {})) url.searchParams.set(name, value);
  const json = call.json !== undefined;
  const headers: Record<string, string> = json
    ? { 'xi-api-key': key, 'content-type': 'application/json' }
    : { 'xi-api-key': key };
  const body = json ? JSON.stringify(call.json) : call.form;
  return {
    url: url.href,
    init: {
      method: call.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(call.signal ? { signal: call.signal } : {}),
    },
  };
}
