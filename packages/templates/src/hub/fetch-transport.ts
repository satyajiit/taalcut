// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `HubTransport` over an injected `fetch`. Local only is checked before any request. Timeouts are 15 s.
 * Retryable hub errors are tried once more, with no sleep (the error still carries `retryAfterSeconds` for the
 * UI). Every Worker response is checked against core's worker-api schema. The install key is sent only in write
 * bodies and is never put on an error.
 */
import {
  err,
  HubNotConfigured,
  HubOffline,
  hubInstallKeySchema,
  hubRatingRequestSchema,
  hubRatingSchema,
  hubRatingsSchema,
  hubReportRequestSchema,
  hubReportResponseSchema,
  hubSubmissionRequestSchema,
  hubSubmissionResponseSchema,
  hubSubmissionStateSchema,
  hubWithdrawRatingSchema,
  LocalOnly,
  ok,
  ValidationError,
  type AsyncResult,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';
import { sha256Hex } from '../store/change-key';
import { hubTemplateFileUrl, hubWorkerUrl, type HubEndpoints } from './endpoints';
import { hubHttpError } from './http-errors';
import { hubInvalid } from './hub-invalid';
import type { HubIndexFetch, HubTransport } from './hub-transport';
import { jsonBodyOf } from './json-body';

const DEFAULT_TIMEOUT_MS = 15_000;
/** One retry, and only these codes (docs/template-hub.md section 7). */
const RETRYABLE = new Set([
  'hub.offline',
  'hub.rate_limited',
  'hub.busy',
  'hub.github_unavailable',
  'hub.integrity',
]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
/** Any JSON value: the index and template files are validated by their readers, after the hash check. */
const jsonValue = z.unknown();

export interface FetchHubTransportOptions {
  readonly endpoints: HubEndpoints | null;
  readonly fetch: typeof globalThis.fetch;
  /** The keychain secret, through main. Never log the value or put it on an error. */
  readonly installKey: () => AsyncResult<string>;
  readonly timeouts?: { readonly requestMs?: number };
  readonly localOnly: () => boolean;
}

interface HttpResponse {
  readonly status: number;
  readonly bytes: Uint8Array;
  readonly etag: string | null;
  readonly retryAfter: string | null;
}

function text(bytes: Uint8Array): Result<string> {
  try {
    return ok(UTF8.decode(bytes));
  } catch {
    // Not UTF-8: refused as a whole, like a body that isn't JSON.
    return err(hubInvalid([{ path: '', rule: 'schema' }]));
  }
}

/** A 2xx body as `schema`, or the error the response stands for. */
function readAs<T>(response: HttpResponse, schema: z.ZodType<T>): Result<T> {
  const body = text(response.bytes);
  if (!body.ok) return body;
  if (response.status < 200 || response.status >= 300)
    return err(hubHttpError(response.status, body.value, response.retryAfter));
  return jsonBodyOf(schema, body.value);
}

/** Local only first, then a build without hub addresses: nothing is fetched. */
function guard(options: FetchHubTransportOptions): Result<HubEndpoints> {
  if (options.localOnly()) return err(LocalOnly({ what: 'hub' }));
  if (!options.endpoints) return err(HubNotConfigured());
  return ok(options.endpoints);
}

async function request(
  options: FetchHubTransportOptions,
  url: string,
  init: RequestInit,
): AsyncResult<HttpResponse> {
  try {
    const response = await options.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(options.timeouts?.requestMs ?? DEFAULT_TIMEOUT_MS),
      headers: { accept: 'application/json', ...init.headers },
    });
    return ok({
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
      etag: response.headers.get('etag'),
      retryAfter: response.headers.get('retry-after'),
    });
  } catch {
    // A network failure, an abort or the timeout: the hub is out of reach; the cause would only name the URL.
    return err(HubOffline());
  }
}

/** One retry of a retryable hub error. */
async function attempt<T>(run: () => AsyncResult<T>): AsyncResult<T> {
  const first = await run();
  if (first.ok || !RETRYABLE.has(first.error.code)) return first;
  return run();
}

async function installKey(options: FetchHubTransportOptions): AsyncResult<string> {
  const value = await options.installKey();
  if (!value.ok) return value;
  return hubInstallKeySchema.safeParse(value.value).success
    ? value
    : err(ValidationError({ field: 'installKey' }));
}

export function createFetchHubTransport(options: FetchHubTransportOptions): HubTransport {
  /** GET of a hub address (the guard first), read as `schema`. */
  function get<T>(url: (endpoints: HubEndpoints) => string, schema: z.ZodType<T>): AsyncResult<T> {
    return attempt(async () => {
      const endpoints = guard(options);
      if (!endpoints.ok) return endpoints;
      const response = await request(options, url(endpoints.value), { method: 'GET' });
      return response.ok ? readAs(response.value, schema) : response;
    });
  }

  /** A Worker write: the request with the install key checked against `requestSchema`, the reply against `responseSchema`. */
  function send<Body extends object, T>(
    requestSchema: z.ZodType,
    responseSchema: z.ZodType<T>,
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body: Body,
  ): AsyncResult<T> {
    return attempt(async () => {
      const endpoints = guard(options);
      if (!endpoints.ok) return endpoints;
      const key = await installKey(options);
      if (!key.ok) return key;
      const checked = requestSchema.safeParse({ ...body, installKey: key.value });
      // The issues would quote the request, key and all: only their count leaves.
      if (!checked.success) return err(hubInvalid([{ path: 'request', rule: 'schema' }]));
      const response = await request(options, hubWorkerUrl(endpoints.value.workerUrl, path), {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(checked.data),
      });
      return response.ok ? readAs(response.value, responseSchema) : response;
    });
  }

  const ratingPath = (hubId: string) => `v0/ratings/${encodeURIComponent(hubId)}`;

  return {
    index(etag) {
      return attempt<HubIndexFetch>(async () => {
        const endpoints = guard(options);
        if (!endpoints.ok) return endpoints;
        const response = await request(options, endpoints.value.indexUrl, {
          method: 'GET',
          headers: etag ? { 'if-none-match': etag } : {},
        });
        if (!response.ok) return response;
        const { status, etag: next } = response.value;
        if (status === 304) return ok({ status: 304 as const, etag: next ?? etag });
        const body = readAs(response.value, jsonValue);
        return body.ok ? ok({ status: 200 as const, body: body.value, etag: next }) : body;
      });
    },

    template(hubId) {
      return attempt(async () => {
        const endpoints = guard(options);
        if (!endpoints.ok) return endpoints;
        const url = hubTemplateFileUrl(endpoints.value.indexUrl, hubId);
        const response = await request(options, url, { method: 'GET' });
        if (!response.ok) return response;
        const body = readAs(response.value, jsonValue);
        // The hash covers the exact bytes the hub's CI hashed, not a re-encoding of the decoded text.
        return body.ok ? ok({ body: body.value, sha256: sha256Hex(response.value.bytes) }) : body;
      });
    },

    ratings: () => get((endpoints) => hubWorkerUrl(endpoints.workerUrl, 'v0/ratings'), hubRatingsSchema),
    submission: (id) =>
      get(
        (endpoints) => hubWorkerUrl(endpoints.workerUrl, `v0/submissions/${encodeURIComponent(id)}`),
        hubSubmissionStateSchema,
      ),
    submit: (body) =>
      send(hubSubmissionRequestSchema, hubSubmissionResponseSchema, 'v0/submissions', 'POST', body),
    rate: (hubId, body) => send(hubRatingRequestSchema, hubRatingSchema, ratingPath(hubId), 'PUT', body),
    withdrawRating: (hubId) =>
      send(hubWithdrawRatingSchema, hubRatingSchema, ratingPath(hubId), 'DELETE', {}),
    report: (body) => send(hubReportRequestSchema, hubReportResponseSchema, 'v0/reports', 'POST', body),
  };
}
