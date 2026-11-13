// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type AsyncResult } from '@taalcut/core';
import {
  PluginAccessDenied,
  PluginAuthenticationFailed,
  PluginInvalidInput,
  PluginRemoteFailed,
} from './errors';
import type { PostizOperation } from './postiz-operation-schema';
import { pluginAttempt } from './safe-result';

export interface UploadInput {
  readonly assetId?: string;
  readonly renderId?: string;
  readonly expectedSha256?: string;
}
export type OpenPluginUpload = (
  input: UploadInput,
  signal: AbortSignal,
) => AsyncResult<{ file: Blob; name: string }>;
export interface PostizHttpOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly openUpload?: OpenPluginUpload;
}
const params = { pluginId: 'postiz' };
const MAX_RESPONSE_BYTES = 4_000_000;

/** Preserve retry advice without retaining response bodies, which may contain account data. */
function remoteFailure(response: Response) {
  const retry = response.headers.get('retry-after');
  const seconds = retry === null ? NaN : Number(retry);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1000
    : retry
      ? Date.parse(retry) - Date.now()
      : NaN;
  return PluginRemoteFailed({
    ...params,
    status: response.status,
    outcome: response.status >= 500 ? 'unknown' : 'rejected',
    ...(Number.isFinite(milliseconds)
      ? { retryAfterMs: Math.max(0, Math.min(milliseconds, 86_400_000)) }
      : {}),
  });
}

/** Read incrementally; a server-controlled Content-Length is not a memory limit. */
async function responseJson(response: Response, signal: AbortSignal): AsyncResult<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return err(
      response.status === 401 || response.status === 403
        ? PluginAuthenticationFailed(params)
        : remoteFailure(response),
    );
  }
  if (response.status === 204) return ok(null);
  const reader = response.body?.getReader();
  if (!reader) return ok(null);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancelled = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelled, { once: true });
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_RESPONSE_BYTES) return err(PluginRemoteFailed(params));
      chunks.push(next.value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(buffer);
    return ok(text ? (JSON.parse(text) as unknown) : null);
  } catch {
    return err(PluginRemoteFailed(params));
  } finally {
    signal.removeEventListener('abort', cancelled);
    await reader.cancel().catch(() => undefined);
  }
}

function route(operation: PostizOperation, input: Record<string, unknown>) {
  const rest = { ...input };
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = String(rest[name]);
    delete rest[name];
    return encodeURIComponent(value);
  });
  return { path, rest };
}

async function requestBody(
  operation: PostizOperation,
  input: Record<string, unknown>,
  options: PostizHttpOptions,
  signal: AbortSignal,
): AsyncResult<RequestInit['body']> {
  if (operation.method === 'GET' || operation.method === 'DELETE') return ok(undefined);
  if (!operation.multipart) return ok(JSON.stringify(input));
  if (!options.openUpload) return err(PluginAccessDenied(params));
  const assetId = typeof input['assetId'] === 'string' ? input['assetId'] : undefined;
  const renderId = typeof input['renderId'] === 'string' ? input['renderId'] : undefined;
  const expectedSha256 = typeof input['expectedSha256'] === 'string' ? input['expectedSha256'] : undefined;
  if (Boolean(assetId) === Boolean(renderId)) return err(PluginInvalidInput(params));
  const opened = await options.openUpload(
    {
      ...(assetId ? { assetId } : {}),
      ...(renderId ? { renderId } : {}),
      ...(expectedSha256 ? { expectedSha256 } : {}),
    },
    signal,
  );
  if (!opened.ok) return opened;
  const data = new FormData();
  data.set('file', opened.value.file, opened.value.name);
  if (input['adjust'] !== undefined) data.set('adjust', String(input['adjust']));
  return ok(data);
}

export function callPostizApi(
  operation: PostizOperation,
  raw: Record<string, unknown>,
  options: PostizHttpOptions,
  signal: AbortSignal,
): AsyncResult<unknown> {
  return pluginAttempt('postiz', signal, async () => {
    const parsed = operation.schema.safeParse(raw);
    if (!parsed.success) return err(PluginInvalidInput(params));
    const pathNames = [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
    if (pathNames.some((name) => /^\.+$/.test(String(parsed.data[name]))))
      return err(PluginInvalidInput(params));
    if (
      operation.name === 'createPost' &&
      parsed.data['type'] !== 'draft' &&
      (!Array.isArray(parsed.data['posts']) || parsed.data['posts'].length === 0)
    )
      return err(PluginInvalidInput(params));
    const { path, rest } = route(operation, parsed.data);
    const url = new URL(options.baseUrl + path);
    if (operation.method === 'GET') {
      for (const [key, value] of Object.entries(rest))
        if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const body = await requestBody(operation, rest, options, signal);
    if (!body.ok) return body;
    const response = await options.fetch(url, {
      method: operation.method,
      headers: {
        Authorization: options.apiKey,
        Accept: 'application/json',
        ...(body.value && !operation.multipart ? { 'Content-Type': 'application/json' } : {}),
      },
      redirect: 'error',
      signal,
      ...(body.value ? { body: body.value } : {}),
    });
    return responseJson(response, signal);
  });
}
