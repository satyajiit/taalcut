// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-RUN: what the run does with a model call that costs nothing, and with one that dropped.
 *
 * A turn on this Mac, or on a plan the person signed in with (ChatGPT), costs them nothing per token: it is never
 * checked against the run's budget, so it never stops the run on a budget card.
 *
 * A call that dropped (models.provider_unavailable: a lost or terminated stream, a 5xx, a stream the model client
 * aborted after it went quiet; or a rate limit whose Retry-After is short) is tried again a few times, with a
 * wait between, before the run fails. Each retry is logged as model.failed with `retry`, so the log says what
 * happened; the loop's next pass asks the model again, as after a restart (ModelCallAbandoned). The model client
 * already moved down the module's chain where it could; this retries what is left.
 */
import { ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import type { ModuleId } from '@taalcut/models';
import type { RunContext } from './context';

/** Waits before each retry, in ms: three retries, then the run fails. */
export const DEFAULT_MODEL_RETRY_DELAYS_MS: readonly number[] = [4_000, 15_000, 35_000];
/** A rate limit that lifts within this long is waited out here; a longer one pauses on its card (G8). */
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
const DROPPED = new Set(['models.provider_unavailable']);

/** True when the next turn of `module` costs the person nothing per token. */
export function isFreeTurn(ctx: RunContext, module: ModuleId): boolean {
  const state = ctx.log.state;
  if (state.started?.localOnly === true) return true;
  const price = ctx.phase2.prices?.price(module);
  if (price?.local === true || price?.planBilled === true) return true;
  // The price lookup can't always say (a plan it hasn't heard of yet): the module's last answer can.
  return state.freeModules?.[module] === true;
}

/** How long to wait before retry `attempt`, or undefined when the error isn't worth another try. */
export function retryDelay(
  error: TaalcutError,
  attempt: number,
  delays: readonly number[],
): number | undefined {
  const base = delays[attempt - 1];
  if (base === undefined) return undefined;
  if (DROPPED.has(error.code)) return base;
  if (error.code === 'models.rate_limited') {
    const after = error.params?.retryAfterMs;
    if (typeof after === 'number' && after <= MAX_RATE_LIMIT_WAIT_MS) return Math.max(base, after);
  }
  return undefined;
}

/**
 * Logs the failed call as one to try again and waits, or answers undefined when it isn't retried (the run then
 * pauses or fails as before). The run stays running: the loop's next pass makes the call again.
 */
export async function retryModelCall(
  ctx: RunContext,
  modelCallId: string,
  error: TaalcutError,
): Promise<AsyncResult<'retrying'> | undefined> {
  if (ctx.signal.aborted) return undefined;
  const delays = ctx.settings.modelRetryDelaysMs ?? DEFAULT_MODEL_RETRY_DELAYS_MS;
  const attempt = (ctx.log.state.modelRetries ?? 0) + 1;
  const delayMs = retryDelay(error, attempt, delays);
  if (delayMs === undefined) return undefined;
  const logged = await ctx.log.append([
    'model.failed',
    { modelCallId, error, retry: { attempt, of: delays.length, delayMs } },
  ]);
  if (!logged.ok) return logged;
  if (!ctx.phase2.replay) await sleep(delayMs, ctx.signal);
  return ok('retrying');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
