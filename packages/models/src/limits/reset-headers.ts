// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a provider's limit lifts, from its response headers (G8). Retry-After is the meter's; these are the
 * providers' own reset headers, read when there is no Retry-After:
 *
 * - OpenAI and xAI: `x-ratelimit-reset-requests` / `-tokens`, a duration such as `6m0s`, `1.5s` or `20ms`.
 * - Anthropic: `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-reset`, an RFC 3339 time.
 * - OpenRouter and others: `x-ratelimit-reset`, epoch seconds or milliseconds.
 * - IETF draft (Cloudflare and others): `ratelimit-reset`, seconds from now.
 *
 * The latest of them wins: a call needs every limit it met to lift.
 */

const DURATION_HEADERS = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens'];
const TIME_HEADERS = [
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-reset',
  'anthropic-ratelimit-input-tokens-reset',
  'anthropic-ratelimit-output-tokens-reset',
];
const UNIT_MS: Readonly<Record<string, number>> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
/** Anything after this (a year) is a misread, not a reset. */
const MAX_AHEAD_MS = 365 * 24 * 3_600_000;

/** Epoch ms when the limit resets, or undefined when no header says. */
export function resetFromHeaders(headers: Headers, now: number): number | undefined {
  const candidates: number[] = [];
  for (const name of DURATION_HEADERS) {
    const ms = parseDuration(headers.get(name));
    if (ms !== undefined) candidates.push(now + ms);
  }
  for (const name of TIME_HEADERS) {
    const at = Date.parse(headers.get(name) ?? '');
    if (Number.isFinite(at)) candidates.push(at);
  }
  const epoch = parseEpoch(headers.get('x-ratelimit-reset'), now);
  if (epoch !== undefined) candidates.push(epoch);
  const delta = Number(headers.get('ratelimit-reset') ?? Number.NaN);
  if (Number.isFinite(delta) && delta >= 0) candidates.push(now + delta * 1000);
  const valid = candidates.filter((at) => at >= now && at - now <= MAX_AHEAD_MS);
  return valid.length > 0 ? Math.max(...valid) : undefined;
}

/** `6m0s`, `1.5s`, `20ms`, `1h2m` → milliseconds. */
export function parseDuration(value: string | null): number | undefined {
  if (!value) return undefined;
  const parts = [...value.trim().matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
  if (parts.length === 0 || parts.map((p) => p[0]).join('') !== value.trim()) return undefined;
  return parts.reduce((total, [, amount, unit]) => total + Number(amount) * (UNIT_MS[unit ?? 's'] ?? 0), 0);
}

/** Epoch seconds or milliseconds; a small number is seconds from now. */
function parseEpoch(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (n > 1e12) return n; // epoch ms
  if (n > 1e9) return n * 1000; // epoch s
  return now + n * 1000; // seconds from now
}
