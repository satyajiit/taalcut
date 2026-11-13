// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Limits (docs/template-hub.md section 4). Bursts are Workers rate-limiting bindings, which are per location and
 * eventually consistent; daily caps are D1 counters taken atomically (store/d1-days.ts). Every key is an install
 * HMAC or, for anonymous reads, an IP: neither is stored except the HMAC inside a day counter's key.
 */
import { type D1Database, type RateLimitBinding } from '../store/d1';
import { takeDailyUnit } from '../store/d1-days';

export const SUBMIT_PER_DAY = 5;
export const SUBMIT_GLOBAL_PER_DAY = 200;
export const REPORTS_PER_DAY = 10;
/** Install keys cost nothing to make, so the per-install cap alone can't stop a flood of moderation issues. */
export const REPORTS_GLOBAL_PER_DAY = 200;
export const SUBMIT_BURST_RETRY_SECONDS = 10;
export const RATE_BURST_RETRY_SECONDS = 60;

export type LimitDecision =
  { ok: true } | { ok: false; code: 'hub.rate_limited' | 'hub.busy'; retryAfterSeconds: number };
export type LimitRefusal = LimitDecision & { ok: false };

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(nowMs: number): number {
  const start = Date.parse(`${utcDay(nowMs)}T00:00:00.000Z`);
  return Math.max(1, Math.ceil((start + 86_400_000 - nowMs) / 1000));
}

async function burst(
  binding: RateLimitBinding,
  key: string,
  retryAfterSeconds: number,
): Promise<LimitDecision> {
  const result = await binding.limit({ key });
  return result.success ? { ok: true } : { ok: false, code: 'hub.rate_limited', retryAfterSeconds };
}

/** The install's daily cap first, so an install over it never spends a unit of the shared one. */
async function daily(
  db: D1Database,
  nowMs: number,
  caps: { install: { key: string; cap: number }; everyone: { key: string; cap: number } },
): Promise<LimitDecision> {
  const day = utcDay(nowMs);
  const retryAfterSeconds = secondsUntilUtcMidnight(nowMs);
  if (!(await takeDailyUnit(db, caps.install.key, day, caps.install.cap)))
    return { ok: false, code: 'hub.rate_limited', retryAfterSeconds };
  if (!(await takeDailyUnit(db, caps.everyone.key, day, caps.everyone.cap)))
    return { ok: false, code: 'hub.busy', retryAfterSeconds };
  return { ok: true };
}

/** 1 per 10 s per install (the binding), 5 per day per install, 200 per day in all. */
export async function takeSubmit(
  db: D1Database,
  submitBurst: RateLimitBinding,
  hmac: string,
  nowMs: number,
): Promise<LimitDecision> {
  const shaped = await burst(submitBurst, hmac, SUBMIT_BURST_RETRY_SECONDS);
  if (!shaped.ok) return shaped;
  return daily(db, nowMs, {
    install: { key: `submit:${hmac}`, cap: SUBMIT_PER_DAY },
    everyone: { key: 'submit:*', cap: SUBMIT_GLOBAL_PER_DAY },
  });
}

/** Ratings: 10 per minute per install (RATE_BURST). */
export function takeRating(rateBurst: RateLimitBinding, hmac: string): Promise<LimitDecision> {
  return burst(rateBurst, hmac, RATE_BURST_RETRY_SECONDS);
}

/** GET /v0/submissions/:id: 60 per minute per IP (READ_BURST). The IP is only the binding's key, never stored. */
export function takeRead(readBurst: RateLimitBinding, ip: string): Promise<LimitDecision> {
  return burst(readBurst, ip, RATE_BURST_RETRY_SECONDS);
}

/** 10 per day per install, 200 per day in all. */
export function takeReport(db: D1Database, hmac: string, nowMs: number): Promise<LimitDecision> {
  return daily(db, nowMs, {
    install: { key: `report:${hmac}`, cap: REPORTS_PER_DAY },
    everyone: { key: 'report:*', cap: REPORTS_GLOBAL_PER_DAY },
  });
}

export function clientIp(request: Request): string {
  const header = request.headers.get('cf-connecting-ip');
  if (header && header.length > 0 && header.length <= 64 && !/[\r\n]/.test(header)) return header;
  return 'unknown';
}
