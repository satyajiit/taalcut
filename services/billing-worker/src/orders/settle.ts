// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Decides what an order is, by asking the payment provider. The buyer's return, the provider's delivery and the
 * scheduled sweep all end here, and none of them is believed on its own word: each is only a reason to look.
 *
 * An order becomes paid when the provider's own record of the link says so, names this order, and carries the
 * amount and currency the order was made with.
 */
import { type BillingDeps } from '../deps';
import { logInfo } from '../log';
import { type Notifier } from '../notify/notifier';
import { type D1Database } from '../store/d1';
import {
  findOrder,
  markBuyerNotified,
  markChecked,
  markClosed,
  markOwnerNotified,
  markPaid,
  type Order,
} from '../store/d1-orders';

export type Settled =
  | { ok: true; order: Order }
  /** `unavailable`: the provider did not answer; ask again. `mismatch`: its record is not this order's. */
  | { ok: false; reason: 'unavailable' | 'mismatch' };

type SettleDeps = Pick<BillingDeps, 'db' | 'provider' | 'notifier' | 'now' | 'defer' | 'config'>;

export async function settle(deps: SettleDeps, order: Order): Promise<Settled> {
  // Only "paid" is final. An order that ran out or was cancelled is read again when a return or a delivery
  // asks about it: if the provider took the money after all, the order must not stay closed.
  if (order.status === 'paid' || order.linkId === null) return { ok: true, order };
  // An order made under the other key pair lives in a ledger this deployment cannot read.
  if (!deps.provider || order.mode !== deps.config.mode) return { ok: false, reason: 'unavailable' };

  const now = deps.now();
  // Before the read: an order whose link cannot be read must not stay at the front of the sweep's line.
  await markChecked(deps.db, order.id, now);
  const read = await deps.provider.getLink(order.linkId);
  if (!read.ok) return { ok: false, reason: read.reason === 'not_found' ? 'mismatch' : 'unavailable' };
  const link = read.value;
  if (link.referenceId !== order.id || link.amount !== order.amount || link.currency !== order.currency) {
    console.error(JSON.stringify({ event: 'billing.link_mismatch', order: order.id, link: link.id }));
    return { ok: false, reason: 'mismatch' };
  }

  if (link.status === 'paid' && link.amountPaid >= order.amount) {
    const payment = link.payments.findLast((entry) => entry.status === 'captured') ?? link.payments.at(-1);
    const made = await markPaid(deps.db, order.id, {
      at: payment ? payment.createdAt * 1000 : now,
      paymentId: payment?.id ?? null,
    });
    const paid = (await findOrder(deps.db, order.id)) ?? order;
    if (made) {
      logInfo('billing.order_paid', { order: order.id, mode: order.mode });
      deps.defer(tell(deps.db, deps.notifier, paid, now));
    }
    return { ok: true, order: paid };
  }
  if (link.status === 'expired' || link.status === 'cancelled') {
    await markClosed(deps.db, order.id, link.status);
    return { ok: true, order: (await findOrder(deps.db, order.id)) ?? order };
  }
  return { ok: true, order };
}

/** Tells us and the buyer about a paid order, and records each telling that went out. */
export async function tell(db: D1Database, notifier: Notifier, order: Order, now: number): Promise<void> {
  if (order.ownerNotifiedAt === null && (await notifier.owner(order)) === 'sent')
    await markOwnerNotified(db, order.id, now);
  if (order.buyerNotifiedAt === null) {
    const told = await notifier.buyer(order);
    // With no email channel there is nothing to retry: the website's own page told the buyer.
    if (told !== 'failed') await markBuyerNotified(db, order.id, now);
  }
}
