// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The limits the models client is waiting on (G8): core's UsageLimits, kept in memory in the process that makes
 * the calls. A rate limit, a used-up quota or a plan that lacks the API is noted when a call fails with one; it
 * is cleared by the next call to the same model that succeeds. A rate limit whose reset time has passed is
 * dropped too (the provider said it lifts then); a quota or plan limit stays until a call succeeds. What waits on
 * a limit (a paused run, background work, an export) is held and released by whoever waits.
 */
import {
  USAGE_LIMIT_KINDS,
  type ModelModuleId,
  type TaalcutError,
  type UsageLimit,
  type UsageLimitKind,
  type UsageLimits,
  type USAGE_LIMIT_WAITERS,
} from '@taalcut/core';
import { billingUrlFor } from './billing-urls';

export type UsageLimitWaiter = (typeof USAGE_LIMIT_WAITERS)[number];

/** A limit a call met. */
export interface LimitMet {
  readonly provider: string;
  readonly model?: string;
  readonly module: ModelModuleId;
  readonly kind: UsageLimitKind;
  /** Epoch ms; null when the provider didn't say. */
  readonly resetsAt: number | null;
  readonly billingUrl?: string;
}

/** What the model client (and any other call path) reports. */
export interface LimitObserver {
  met(limit: LimitMet): void;
  /** A call to this model succeeded: its limits are gone. */
  cleared(provider: string, model: string): void;
}

export interface UsageLimitsTracker extends UsageLimits, LimitObserver {
  /** Marks `waiter` as waiting on the provider's limits until the returned function is called. */
  hold(provider: string, waiter: UsageLimitWaiter): () => void;
}

/** At most this many limits are kept (core's usageLimitsSchema); the oldest go first. */
const MAX_LIMITS = 64;

const CODE_KINDS: Readonly<Record<string, UsageLimitKind>> = {
  'models.rate_limited': 'rate',
  'models.quota_exceeded': 'quota',
  'models.plan_required': 'plan',
};

/** The limit an error reports, if it is one (models.rate_limited, quota_exceeded, plan_required). */
export function limitOfError(
  error: TaalcutError,
  module: ModelModuleId,
  fallback: { readonly provider: string; readonly model?: string },
  now: number,
): LimitMet | undefined {
  const kind = CODE_KINDS[error.code];
  if (!kind) return undefined;
  const params = error.params ?? {};
  const provider = typeof params.provider === 'string' ? params.provider : fallback.provider;
  const model = typeof params.model === 'string' ? params.model : fallback.model;
  const resetsAt =
    typeof params.resetsAt === 'number'
      ? params.resetsAt
      : typeof params.retryAfterMs === 'number'
        ? now + params.retryAfterMs
        : null;
  const billingUrl =
    typeof params.billingUrl === 'string'
      ? params.billingUrl
      : kind === 'quota'
        ? billingUrlFor(provider)
        : undefined;
  return {
    provider,
    ...(model ? { model } : {}),
    module,
    kind,
    resetsAt,
    ...(billingUrl ? { billingUrl } : {}),
  };
}

export function createUsageLimitsTracker(deps: { readonly now?: () => number } = {}): UsageLimitsTracker {
  const now = deps.now ?? Date.now;
  const entries = new Map<string, UsageLimit>();
  const waiters = new Map<string, Map<UsageLimitWaiter, number>>();
  const listeners = new Set<(limits: readonly UsageLimit[]) => void>();
  const keyOf = (provider: string, model: string | undefined) => `${provider}\u0000${model ?? ''}`;

  const waitingOn = (provider: string): UsageLimit['waiting'] =>
    [...(waiters.get(provider)?.entries() ?? [])].filter(([, count]) => count > 0).map(([w]) => w);

  /** Rate limits whose reset passed are gone. Returns whether anything was dropped. */
  const expire = (): boolean => {
    let dropped = false;
    for (const [key, limit] of entries) {
      if (limit.kind === 'rate' && limit.resetsAt !== null && limit.resetsAt <= now()) {
        entries.delete(key);
        dropped = true;
      }
    }
    return dropped;
  };

  const current = (): UsageLimit[] => {
    expire();
    return [...entries.values()].map((limit) => ({ ...limit, waiting: waitingOn(limit.provider) }));
  };

  const changed = () => {
    const limits = current();
    for (const listener of listeners) {
      try {
        listener(limits);
      } catch {
        // A follower's bug must not break model calls.
      }
    }
  };

  return {
    current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    met(input) {
      if (!(USAGE_LIMIT_KINDS as readonly string[]).includes(input.kind)) return;
      const key = keyOf(input.provider, input.model);
      const known = entries.get(key);
      const modules = [...new Set([...(known?.modules ?? []), input.module])];
      entries.delete(key);
      entries.set(key, {
        provider: input.provider,
        ...(input.model ? { model: input.model } : {}),
        modules,
        kind: input.kind,
        // The first time it was met: "since 10:42".
        since: known && known.kind === input.kind ? known.since : now(),
        resetsAt: input.resetsAt,
        waiting: [],
        ...(input.billingUrl ? { billingUrl: input.billingUrl } : {}),
      });
      while (entries.size > MAX_LIMITS) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      changed();
    },
    cleared(provider, model) {
      const exact = entries.delete(keyOf(provider, model));
      // A limit noted for the whole provider (no model) lifts with any of its models.
      const whole = entries.delete(keyOf(provider, undefined));
      if (exact || whole) changed();
    },
    hold(provider, waiter) {
      const counts = waiters.get(provider) ?? new Map<UsageLimitWaiter, number>();
      waiters.set(provider, counts);
      counts.set(waiter, (counts.get(waiter) ?? 0) + 1);
      changed();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        counts.set(waiter, Math.max(0, (counts.get(waiter) ?? 1) - 1));
        changed();
      };
    },
  };
}
