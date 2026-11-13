// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every image provider shares on the wire: how an HTTP failure becomes a TaalcutError, and the one
 * CloudCall row each request writes (module `images`, billed in images, never the prompt or the key).
 */
import {
  CancelledError,
  newId,
  type Billed,
  type CloudCallRecord,
  type CloudCallSink,
  type TaalcutError,
} from '@taalcut/core';
import { recordCloudCall } from '../calls/cloud-call';
import {
  ImageAccessDenied,
  ModelAuthInvalid,
  ModelBadRequest,
  ModelContentFiltered,
  ModelProviderUnavailable,
  ModelQuotaExceeded,
  ModelRateLimited,
  UnknownModel,
} from '../errors';
import { scrubSecrets } from '../scrub';
import type { ImageAccess, ImageTrace } from './image-types';

const QUOTA =
  /insufficient_quota|quota|billing|credit|balance|payment required|usage_limit_reached|usage_not_included/i;
const FILTERED = /safety|moderation|content.?policy|content.?filter|blocked/i;

export interface FailureFacts {
  readonly provider: string;
  readonly model: string;
  readonly status: number;
  readonly body: string;
  readonly access?: ImageAccess;
  readonly retryAfterMs?: number;
  /** Scrubbed out of the developer detail. */
  readonly secrets: readonly string[];
}

/** An HTTP error response as the error the fallback rules and the UI understand. */
export function imageHttpFailure(facts: FailureFacts): TaalcutError {
  const params = { provider: facts.provider, model: facts.model };
  const extras = { detail: scrubSecrets(facts.body, facts.secrets).slice(0, 2000) };
  const { status, body } = facts;
  if (status === 402 || ((status === 429 || status === 403) && QUOTA.test(body)))
    return ModelQuotaExceeded(params, extras);
  if (status === 401) return ModelAuthInvalid(params, extras);
  if (status === 403) {
    if (FILTERED.test(body)) return ModelContentFiltered(params, extras);
    return facts.access === 'subscription'
      ? ImageAccessDenied(params, extras)
      : ModelAuthInvalid(params, extras);
  }
  if (status === 429) {
    return ModelRateLimited(
      facts.retryAfterMs === undefined ? params : { ...params, retryAfterMs: facts.retryAfterMs },
      extras,
    );
  }
  if (status === 408 || status >= 500) return ModelProviderUnavailable(params, extras);
  if (status === 404) return UnknownModel(params, extras);
  if (FILTERED.test(body)) return ModelContentFiltered(params, extras);
  return ModelBadRequest(params, extras);
}

/** A fetch that threw: the stop button or the tool's timeout, else the network. */
export function imageFetchFailure(
  cause: unknown,
  aborted: boolean,
  facts: Pick<FailureFacts, 'provider' | 'model' | 'secrets'>,
): TaalcutError {
  if (aborted) return CancelledError();
  const message = cause instanceof Error ? cause.message : String(cause);
  return ModelProviderUnavailable(
    { provider: facts.provider, model: facts.model },
    { detail: scrubSecrets(message, facts.secrets).slice(0, 2000) },
  );
}

export interface ImageCallRow {
  readonly provider: string;
  readonly model: string;
  readonly startedAt: number;
  readonly latencyMs: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd: number;
  readonly billing?: CloudCallRecord['billing'];
  /** Images the provider returned and Taalcut kept; 0 on a failure. */
  readonly images: number;
  readonly error?: TaalcutError;
  readonly httpStatus?: number;
  readonly attempt: number;
  readonly trace?: ImageTrace;
}

/** Writes the request's row. A failing sink never fails the call (recordCloudCall warns). */
export function recordImageCall(sink: CloudCallSink, row: ImageCallRow): Promise<void> {
  const billed: Billed = { unit: 'image', quantity: row.images };
  const outcome: CloudCallRecord['outcome'] = !row.error
    ? 'ok'
    : CancelledError.is(row.error)
      ? 'cancelled'
      : 'error';
  const record: CloudCallRecord = {
    id: newId<'CloudCall'>(),
    module: 'images',
    provider: row.provider,
    model: row.model,
    reasoning: 'off',
    local: false,
    startedAt: row.startedAt,
    latencyMs: row.latencyMs,
    bytesSent: row.bytesSent,
    bytesReceived: row.bytesReceived,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: row.costUsd,
    ...(row.billing ? { billing: row.billing } : {}),
    outcome,
    ...(row.error ? { errorCode: row.error.code } : {}),
    ...(row.httpStatus !== undefined ? { httpStatus: row.httpStatus } : {}),
    attempt: row.attempt,
    ...(row.trace?.runId ? { runId: row.trace.runId } : {}),
    ...(row.trace?.spanId ? { spanId: row.trace.spanId } : {}),
    ...(row.trace?.projectId ? { projectId: row.trace.projectId } : {}),
    billed,
  };
  return recordCloudCall(sink, record);
}
