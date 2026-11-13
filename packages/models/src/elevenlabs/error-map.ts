// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An ElevenLabs HTTP failure as a TaalcutError (SPEC P3.2): 401 auth, 402 or a quota body quota, 429 rate limit with
 * Retry-After, 422 bad request naming the field, 5xx unavailable. Bodies look like `{ detail: { status, message } }`
 * or, for validation, `{ detail: [{ loc, msg }] }`. The detail is scrubbed of the key before it lands anywhere.
 */
import { jsonFromText, type TaalcutError } from '@taalcut/core';
import { z } from 'zod';
import {
  ModelAuthInvalid,
  ModelBadRequest,
  ModelProviderError,
  ModelProviderUnavailable,
  ModelQuotaExceeded,
  ModelRateLimited,
} from '../errors';
import { scrubSecrets } from '../scrub';
import { ELEVENLABS_PROVIDER } from './config';
import { ModelPlanRequired } from './errors';

const detailSchema = z.object({
  detail: z.union([
    z.object({ status: z.string().optional(), message: z.string().optional() }),
    z.array(
      z.object({ loc: z.array(z.union([z.string(), z.number()])).optional(), msg: z.string().optional() }),
    ),
    z.string(),
  ]),
});
type Detail = z.output<typeof detailSchema>['detail'];

const QUOTA = /quota_exceeded|insufficient|credits?|character_limit/i;
const PLAN = /payment_required|plan|subscription|paid_plan_required|upgrade/i;
const VALIDATION = /^invalid_output_format$|^validation_error$/i;

export interface WireFailure {
  readonly status: number;
  readonly body: string;
  readonly model: string;
  /** The module's feature, for a plan refusal ('voice', 'music'). */
  readonly feature: string;
  readonly retryAfterMs?: number;
  readonly secrets: readonly string[];
}

/** The body's `detail.status` (e.g. 'quota_exceeded'), or ''. */
function statusOf(detail: Detail | undefined): string {
  return detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail.status ?? '') : '';
}

/** The validation field a 422 names: the last string of its `loc`, e.g. 'text'. */
function fieldOf(detail: Detail | undefined): string | undefined {
  if (!Array.isArray(detail)) return undefined;
  const loc = detail[0]?.loc ?? [];
  return loc.filter((part): part is string => typeof part === 'string' && part !== 'body').at(-1);
}

/** 401, 402 and 403: a plan the account lacks, a key it rejects, or a quota used up. */
function accountError(failure: WireFailure, status: string, extras: { detail: string }): TaalcutError {
  const params = { provider: ELEVENLABS_PROVIDER, model: failure.model };
  if (PLAN.test(status))
    return ModelPlanRequired({ provider: ELEVENLABS_PROVIDER, feature: failure.feature }, extras);
  return failure.status === 402 ? ModelQuotaExceeded(params, extras) : ModelAuthInvalid(params, extras);
}

/** Every other status, by its HTTP class. */
function statusError(failure: WireFailure, extras: { detail: string }): TaalcutError {
  const params = { provider: ELEVENLABS_PROVIDER, model: failure.model };
  if (failure.status === 429) {
    const wait = failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {};
    return ModelRateLimited({ ...params, ...wait }, extras);
  }
  if (failure.status === 400 || failure.status === 422) return ModelBadRequest(params, extras);
  return failure.status >= 500
    ? ModelProviderUnavailable(params, extras)
    : ModelProviderError(params, extras);
}

export function wireError(failure: WireFailure): TaalcutError {
  const parsed = detailSchema.safeParse(jsonFromText(failure.body));
  const detail = parsed.success ? parsed.data.detail : undefined;
  const status = statusOf(detail);
  const field = fieldOf(detail);
  const text = scrubSecrets(failure.body, failure.secrets).slice(0, 2000);
  const extras = { detail: field ? `field: ${field}; ${text}` : text };
  // ElevenLabs answers a used-up quota with 401 and `quota_exceeded`, so the body is read first.
  if (QUOTA.test(status))
    return ModelQuotaExceeded({ provider: ELEVENLABS_PROVIDER, model: failure.model }, extras);
  if (VALIDATION.test(status))
    return ModelBadRequest({ provider: ELEVENLABS_PROVIDER, model: failure.model }, extras);
  if ([401, 402, 403].includes(failure.status)) return accountError(failure, status, extras);
  return statusError(failure, extras);
}
