// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The orders table. Every change that matters is one conditional statement with RETURNING, so two requests about
 * the same order (the buyer's return and the provider's delivery often arrive together) can't both make it.
 */
import { z } from 'zod';

import { type D1Database } from './d1';

export type OrderStatus = 'created' | 'paid' | 'expired' | 'cancelled' | 'failed';

const orderRow = z.object({
  id: z.string(),
  mode: z.enum(['live', 'test']),
  plan: z.string(),
  currency: z.string(),
  amount: z.number().int(),
  list_amount: z.number().int(),
  offer_id: z.string().nullable(),
  status: z.enum(['created', 'paid', 'expired', 'cancelled', 'failed']),
  name: z.string(),
  email: z.string(),
  whatsapp: z.string().nullable(),
  channel: z.string().nullable(),
  country: z.string().nullable(),
  link_id: z.string().nullable(),
  payment_id: z.string().nullable(),
  created_at: z.number().int(),
  expires_at: z.number().int(),
  paid_at: z.number().int().nullable(),
  owner_notified_at: z.number().int().nullable(),
  buyer_notified_at: z.number().int().nullable(),
});

export interface Order {
  id: string;
  mode: 'live' | 'test';
  plan: string;
  currency: string;
  amount: number;
  listAmount: number;
  offerId: string | null;
  status: OrderStatus;
  name: string;
  email: string;
  whatsapp: string | null;
  channel: string | null;
  country: string | null;
  linkId: string | null;
  paymentId: string | null;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  ownerNotifiedAt: number | null;
  buyerNotifiedAt: number | null;
}

export type NewOrder = Omit<
  Order,
  'status' | 'linkId' | 'paymentId' | 'paidAt' | 'ownerNotifiedAt' | 'buyerNotifiedAt'
>;

function toOrder(row: unknown): Order | null {
  if (row === null) return null;
  const r = orderRow.parse(row);
  return {
    id: r.id,
    mode: r.mode,
    plan: r.plan,
    currency: r.currency,
    amount: r.amount,
    listAmount: r.list_amount,
    offerId: r.offer_id,
    status: r.status,
    name: r.name,
    email: r.email,
    whatsapp: r.whatsapp,
    channel: r.channel,
    country: r.country,
    linkId: r.link_id,
    paymentId: r.payment_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    paidAt: r.paid_at,
    ownerNotifiedAt: r.owner_notified_at,
    buyerNotifiedAt: r.buyer_notified_at,
  };
}

export async function insertOrder(db: D1Database, order: NewOrder): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (id, mode, plan, currency, amount, list_amount, offer_id, status, name, email, whatsapp,
         channel, country, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      order.id,
      order.mode,
      order.plan,
      order.currency,
      order.amount,
      order.listAmount,
      order.offerId,
      order.name,
      order.email,
      order.whatsapp,
      order.channel,
      order.country,
      order.createdAt,
      order.expiresAt,
    )
    .run();
}

export async function findOrder(db: D1Database, id: string): Promise<Order | null> {
  return toOrder(await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first());
}

export async function findOrderByLink(db: D1Database, linkId: string): Promise<Order | null> {
  return toOrder(await db.prepare('SELECT * FROM orders WHERE link_id = ?').bind(linkId).first());
}

export async function attachLink(db: D1Database, id: string, linkId: string): Promise<void> {
  await db
    .prepare("UPDATE orders SET link_id = ? WHERE id = ? AND status = 'created'")
    .bind(linkId, id)
    .run();
}

/** The order was never payable: the provider made no link for it. */
export async function markFailed(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'created'").bind(id).run();
}

/** True when this call is the one that made the order paid. A paid order is never changed again. */
export async function markPaid(
  db: D1Database,
  id: string,
  paid: { at: number; paymentId: string | null },
): Promise<boolean> {
  const row = await db
    .prepare(
      "UPDATE orders SET status = 'paid', paid_at = ?, payment_id = ? WHERE id = ? AND status != 'paid' RETURNING id",
    )
    .bind(paid.at, paid.paymentId, id)
    .first();
  return row !== null;
}

/** The link ran out or was cancelled before a payment. */
export async function markClosed(db: D1Database, id: string, status: 'expired' | 'cancelled'): Promise<void> {
  await db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'created'").bind(status, id).run();
}

export async function markChecked(db: D1Database, id: string, at: number): Promise<void> {
  await db.prepare('UPDATE orders SET checked_at = ? WHERE id = ?').bind(at, id).run();
}

export async function markOwnerNotified(db: D1Database, id: string, at: number): Promise<void> {
  await db.prepare('UPDATE orders SET owner_notified_at = ? WHERE id = ?').bind(at, id).run();
}

export async function markBuyerNotified(db: D1Database, id: string, at: number): Promise<void> {
  await db.prepare('UPDATE orders SET buyer_notified_at = ? WHERE id = ?').bind(at, id).run();
}

async function ordersOf(db: D1Database, query: string, values: (string | number)[]): Promise<Order[]> {
  const { results } = await db
    .prepare(query)
    .bind(...values)
    .all();
  return results.map((row) => toOrder(row)).filter((order) => order !== null);
}

/** Orders with a link and no outcome yet, made before `before`: the ones least recently looked at first. */
export function openOrders(db: D1Database, mode: string, before: number, limit: number): Promise<Order[]> {
  return ordersOf(
    db,
    `SELECT * FROM orders WHERE status = 'created' AND link_id IS NOT NULL AND mode = ? AND created_at <= ?
       ORDER BY COALESCE(checked_at, 0) ASC LIMIT ?`,
    [mode, before, limit],
  );
}

/**
 * Paid orders somebody has not been told about: paid after `since`, and found to be paid before `learnedBefore`.
 * The second bound leaves an order alone while the request that just found it paid is still telling people.
 */
export function unnotifiedOrders(
  db: D1Database,
  since: number,
  learnedBefore: number,
  limit: number,
): Promise<Order[]> {
  return ordersOf(
    db,
    `SELECT * FROM orders WHERE status = 'paid' AND paid_at >= ? AND COALESCE(checked_at, 0) <= ?
       AND (owner_notified_at IS NULL OR buyer_notified_at IS NULL) ORDER BY paid_at ASC LIMIT ?`,
    [since, learnedBefore, limit],
  );
}

/** Orders made before `before` whose link was never made are closed as failed. */
export async function failLinkless(db: D1Database, before: number): Promise<void> {
  await db
    .prepare(
      "UPDATE orders SET status = 'failed' WHERE status = 'created' AND link_id IS NULL AND created_at < ?",
    )
    .bind(before)
    .run();
}

/** An order never paid is deleted, with the name and address typed into it. */
export async function deleteUnpaid(db: D1Database, before: number): Promise<void> {
  await db.prepare("DELETE FROM orders WHERE status != 'paid' AND created_at < ?").bind(before).run();
}
