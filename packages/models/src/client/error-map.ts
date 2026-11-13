// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns a failed pi-ai call into a TaalcutError. pi-ai reports failures as an
 * assistant message with stopReason 'error' and a provider-specific string, so
 * we combine the HTTP status the meter saw with the message text. The order
 * matters: context overflow and quota errors often arrive as 400 or 429.
 */
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { isContextOverflow } from '@earendil-works/pi-ai';
import { CancelledError, type TaalcutError } from '@taalcut/core';
import {
  ModelAuthExpired,
  ModelAuthInvalid,
  ModelBadRequest,
  ModelContentFiltered,
  ModelContextTooLong,
  ModelNotConfigured,
  ModelProviderError,
  ModelProviderUnavailable,
  ModelQuotaExceeded,
  ModelRateLimited,
  UnknownModel,
} from '../errors';
import { billingUrlFor } from '../limits/billing-urls';
import { scrubSecrets } from '../scrub';

export interface FailureContext {
  readonly provider: string;
  readonly model: string;
  readonly message: AssistantMessage;
  readonly aborted: boolean;
  /** Status of the provider's last HTTP response, from the meter. */
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  /** When the provider's limit lifts (epoch ms), from its reset headers (G8). */
  readonly resetAt?: number;
  /** Now, for turning Retry-After into a reset time. */
  readonly now?: number;
  readonly contextWindow?: number;
  /** The credential was a short-lived sign-in token, so a 401 means "expired", not "wrong". */
  readonly oauth: boolean;
  /** Values to scrub from the developer detail (the request's secret). */
  readonly secrets: readonly string[];
}

const QUOTA =
  /insufficient_quota|quota exceeded|out of budget|billing|usage.?limit|subscription_sharing_usage_limit_exceeded|available balance|credit balance/i;
const NOT_CONFIGURED = /no api key|not configured|missing api key|requires? (an )?api key/i;
const RATE_LIMIT = /rate.?limit|too many requests|requests per (minute|day)/i;
const UNAVAILABLE =
  /overloaded|server.?busy|at capacity|high demand|service.?unavailable|internal.?(server.?)?error|server.?error|bad gateway|gateway time.?out|fetch failed|network.?error|connection.?(error|refused|reset|lost)|econnrefused|econnreset|enotfound|eai_again|socket hang up|other side closed|timed? ?out|upstream connect/i;
/**
 * Node's fetch (undici) fails a body read whose socket closed with exactly this message, and pi-ai passes it on
 * without its cause ("other side closed"): the connection dropped mid-stream. Matched whole, so no provider text that
 * merely contains the word is read as a dropped connection.
 */
const DROPPED = /^\s*terminated\s*$/i;
const FILTERED = /content.?filter|safety|sensitive|refus(al|ed) by policy/i;
const UNKNOWN_MODEL =
  /model[^.]{0,40}(not found|does not exist|unknown|not supported)|unknown model|no such model/i;
const AUTH =
  /unauthori[sz]ed|invalid.{0,20}(api.?key|token|credentials)|authentication|incorrect api key|expired token|token.{0,10}expired/i;

export function classifyFailure(context: FailureContext): TaalcutError {
  const text = context.message.errorMessage ?? '';
  const detail = scrubSecrets(text, context.secrets).slice(0, 2000);
  const params = { provider: context.provider, model: context.model };
  const extras = { detail };

  if (context.aborted || context.message.stopReason === 'aborted') return CancelledError(undefined, extras);
  if (isContextOverflow(context.message, context.contextWindow)) return ModelContextTooLong(params, extras);

  const status = statusOf(context.httpStatus, text);
  if (status === 402 || QUOTA.test(text)) return ModelQuotaExceeded(quotaParams(context, params), extras);
  if (status === 401)
    return context.oauth ? ModelAuthExpired(params, extras) : ModelAuthInvalid(params, extras);
  if (status === 403) return ModelAuthInvalid(params, extras);
  if (status === undefined && NOT_CONFIGURED.test(text)) return ModelNotConfigured(params, extras);
  if (status === 429 || RATE_LIMIT.test(text))
    return ModelRateLimited(rateParams(context, params, text), extras);
  if (
    (status !== undefined && (status >= 500 || status === 408)) ||
    UNAVAILABLE.test(text) ||
    DROPPED.test(text)
  ) {
    return ModelProviderUnavailable(params, extras);
  }
  if (FILTERED.test(text)) return ModelContentFiltered(params, extras);
  if (status === 404 || UNKNOWN_MODEL.test(text)) return UnknownModel(params, extras);
  if (status === undefined && AUTH.test(text)) return ModelAuthInvalid(params, extras);
  if (status !== undefined && status >= 400) return ModelBadRequest(params, extras);
  return ModelProviderError(params, extras);
}

type LimitParams = { readonly provider: string; readonly model: string };

/** A quota: when it resets (the provider's headers) and the provider's billing page, when known (G8). */
function quotaParams(context: FailureContext, params: LimitParams) {
  const billingUrl = billingUrlFor(context.provider);
  return {
    ...params,
    ...(context.resetAt !== undefined ? { resetsAt: context.resetAt } : {}),
    ...(billingUrl ? { billingUrl } : {}),
  };
}

/** A rate limit: Retry-After (header or text) and when it lifts, else the provider's reset header (G8). */
function rateParams(context: FailureContext, params: LimitParams, text: string) {
  const retryAfter = context.retryAfterMs ?? retryAfterFromText(text);
  const resetsAt =
    retryAfter !== undefined && context.now !== undefined ? context.now + retryAfter : context.resetAt;
  return {
    ...params,
    ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

/** The meter's status wins; otherwise pi-ai's "Provider API error (429): ..." or a leading status. */
function statusOf(httpStatus: number | undefined, text: string): number | undefined {
  if (httpStatus !== undefined && httpStatus >= 400) return httpStatus;
  const match = /\((\d{3})\)|^(\d{3})\b|status(?: code)?:? (\d{3})/i.exec(text);
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return value >= 400 && value < 600 ? value : undefined;
}

function retryAfterFromText(text: string): number | undefined {
  const match = /(?:retry|try again) (?:after|in) (\d+(?:\.\d+)?)\s*(ms|s|seconds?)/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2]?.toLowerCase() === 'ms' ? value : value * 1000;
}
