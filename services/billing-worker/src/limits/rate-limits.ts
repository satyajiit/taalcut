// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Limits on the order form. An order makes a payment link at the provider and stores a name and an address, so a
 * flood of forms must not turn into a flood of either, and one caller must not be able to use up everyone's day.
 *
 * - A burst per caller: a Workers rate-limiting binding. The caller's address is used for the count and not kept.
 * - A day's allowance per caller, then one for everyone: D1 counters taken atomically. The per-caller counter is
 *   kept under a keyed hash of the caller's network, never the address itself, and deleted the next day.
 *
 * A caller is an IPv4 address or an IPv6 /64: one subscriber usually holds a whole /64, and counting each of its
 * addresses apart would be no limit at all. Someone with many networks can still use up the shared allowance; the
 * website then offers the address to write to. Only a human check on the form closes that.
 */
import { hmacHex } from '../razorpay/signature';
import { type D1Database, type RateLimitBinding } from '../store/d1';
import { takeDailyUnit } from '../store/d1-days';

export const CHECKOUTS_PER_CALLER_PER_DAY = 10;
export const CHECKOUTS_PER_DAY = 300;
export const BURST_RETRY_SECONDS = 60;

export type LimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(nowMs: number): number {
  const start = Date.parse(`${utcDay(nowMs)}T00:00:00.000Z`);
  return Math.max(1, Math.ceil((start + 86_400_000 - nowMs) / 1000));
}

/** The first four groups of an IPv6 address, written in full: its /64. Null when the text is not IPv6. */
function ipv6Network(address: string): string | null {
  if (!/^[0-9a-f:]+$/i.test(address)) return null;
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const head = (halves[0] ?? '').split(':').filter((group) => group.length > 0);
  const tail = (halves[1] ?? '').split(':').filter((group) => group.length > 0);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...tail];
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}

/** The network Cloudflare saw the request come from: an IPv4 address, or an IPv6 address's /64. */
export function callerKey(request: Request): string {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const network = address.includes(':') ? ipv6Network(address) : null;
  return network === null ? address : `${network}::/64`;
}

export async function takeBurst(binding: RateLimitBinding, key: string): Promise<LimitDecision> {
  const result = await binding.limit({ key });
  return result.success ? { ok: true } : { ok: false, retryAfterSeconds: BURST_RETRY_SECONDS };
}

export interface CheckoutLimits {
  db: D1Database;
  burst: RateLimitBinding;
  /** Keys the hash the per-caller counter is kept under, so the counter cannot be turned back into an address. */
  hashKey: string;
}

/**
 * One order's worth of every limit, cheapest first: the caller's burst, the caller's day, everyone's day. A caller
 * over their own limit never spends a unit of the shared one.
 */
export async function takeCheckout(
  limits: CheckoutLimits,
  caller: string,
  nowMs: number,
): Promise<LimitDecision> {
  const burst = await takeBurst(limits.burst, caller);
  if (!burst.ok) return burst;
  const day = utcDay(nowMs);
  const untilMidnight = { ok: false as const, retryAfterSeconds: secondsUntilUtcMidnight(nowMs) };
  const hashed = (await hmacHex(limits.hashKey, `limit|${day}|${caller}`)).slice(0, 32);
  if (!(await takeDailyUnit(limits.db, `checkout:${hashed}`, day, CHECKOUTS_PER_CALLER_PER_DAY)))
    return untilMidnight;
  if (!(await takeDailyUnit(limits.db, 'checkout:*', day, CHECKOUTS_PER_DAY))) return untilMidnight;
  return { ok: true };
}
