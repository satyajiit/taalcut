// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Every refusal the API can send. plan/premium-round-1.md lists what each means. */
export type BillingErrorCode =
  | 'billing.invalid'
  | 'billing.unauthorized'
  | 'billing.forbidden'
  | 'billing.not_found'
  | 'billing.price_changed'
  | 'billing.rate_limited'
  | 'billing.busy'
  | 'billing.provider_unavailable'
  | 'billing.not_selling';

/** One thing wrong with a request: which field, and which rule it broke. */
export interface Problem {
  path: string;
  rule: 'required' | 'format' | 'tooShort' | 'tooLong' | 'tooLarge' | 'unknown' | 'schema' | 'signature';
}

/** JSON that no cache keeps: a price, an order and a payment state are all true for a moment only. */
export function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers });
}

export function invalid(problems: readonly Problem[], status = 400): Response {
  return json({ code: 'billing.invalid', problems }, status);
}

/** A body a JSON route could not read: 413 over the size cap, 415 when it is not sent as JSON, 400 otherwise. */
export function unreadable(body: { reason: 'too-large' | 'invalid' | 'not-json' }): Response {
  if (body.reason === 'too-large') return invalid([{ path: '', rule: 'tooLarge' }], 413);
  return invalid([{ path: '', rule: 'schema' }], body.reason === 'not-json' ? 415 : 400);
}

export function fail(code: BillingErrorCode, status: number, extra?: Record<string, unknown>): Response {
  return json({ code, ...extra }, status);
}

export function rateLimited(retryAfterSeconds: number): Response {
  return json({ code: 'billing.rate_limited', retryAfterSeconds }, 429, {
    'retry-after': String(retryAfterSeconds),
  });
}
