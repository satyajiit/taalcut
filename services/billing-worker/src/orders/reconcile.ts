// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The scheduled sweep. It is what makes an order paid when the buyer closed the tab before coming back and no
 * delivery arrived: every open order is looked up at the provider until it has an outcome. It also retries
 * tellings that did not go out, and deletes what the privacy page says is deleted.
 */
import { type BillingDeps } from '../deps';
import { utcDay } from '../limits/rate-limits';
import { deleteOldDayCounts, deleteOldEvents } from '../store/d1-events';
import { deleteUnpaid, failLinkless, openOrders, unnotifiedOrders } from '../store/d1-orders';
import { settle, tell } from './settle';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** An order this young is left to the buyer's own return, and a telling this young to the request that started it. */
const SETTLE_AFTER_MS = 2 * MINUTE;
/** Orders looked up, and tellings retried, in one run. Each is a request that may take seconds. */
const BATCH = 20;
/**
 * A run stops starting work after this long. With the provider's and the chat webhook's own time limits, a run
 * then ends well inside the five minutes to the next one, so two runs never tell the same people.
 */
const RUN_BUDGET_MS = 2 * MINUTE;
/** An order never paid is deleted after this long (the privacy page says "within 30 days"). */
export const UNPAID_KEPT_MS = 28 * DAY;
/** A telling is retried for this long after the payment. */
const TELL_FOR_MS = 7 * DAY;

type SweepDeps = Pick<BillingDeps, 'db' | 'config' | 'provider' | 'notifier' | 'now' | 'defer'>;

export async function sweep(deps: SweepDeps): Promise<{ looked: number; told: number }> {
  const now = deps.now();
  let looked = 0;
  if (deps.provider) {
    for (const order of await openOrders(deps.db, deps.config.mode, now - SETTLE_AFTER_MS, BATCH)) {
      if (deps.now() - now > RUN_BUDGET_MS) break;
      const settled = await settle(deps, order);
      looked += 1;
      // The provider is away: the rest of the batch would fail the same way. The next run starts again.
      if (!settled.ok && settled.reason === 'unavailable') break;
    }
  }

  const waiting = await unnotifiedOrders(deps.db, now - TELL_FOR_MS, now - SETTLE_AFTER_MS, BATCH);
  for (const order of waiting) {
    if (deps.now() - now > RUN_BUDGET_MS) break;
    await tell(deps.db, deps.notifier, order, now);
  }

  await failLinkless(deps.db, now - 10 * MINUTE);
  await deleteUnpaid(deps.db, now - UNPAID_KEPT_MS);
  await deleteOldEvents(deps.db, now - 30 * DAY);
  // Only today's counters are of use: the first run after UTC midnight deletes the day before's.
  await deleteOldDayCounts(deps.db, utcDay(now));
  return { looked, told: waiting.length };
}
