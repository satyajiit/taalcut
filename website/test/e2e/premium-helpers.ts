// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Page, Request, Route } from '@playwright/test';

/**
 * What the Premium specs share: the billing service's answers as its API (version 1) writes them, and routes that
 * give them. Nothing here reaches the real service: every billing request a test makes is answered by a route, in a
 * build that points billing at the site's own origin (`pnpm e2e`) or at the real address alike.
 */

export const LIST = {
  plan: 'premium',
  currency: 'USD',
  amount: 40000,
  listAmount: 40000,
  offer: null,
  selling: true,
};
export const LAUNCH = {
  ...LIST,
  amount: 33900,
  offer: { id: 'product-hunt', endsAt: '2026-11-26T08:01:00.000Z' },
};
export const ORDER_ID = '01KA7Q3ZV5R8N2M4X6C9D1E3F5';
/** A payment page on a host that doesn't exist: a route answers it, so the browser really navigates there. */
export const PAY_URL = 'https://pay.example/l/abc123';
export const CHECKOUT = { orderId: ORDER_ID, payUrl: PAY_URL, currency: 'USD', amount: 33900 };
export const PAID = {
  orderId: ORDER_ID,
  status: 'paid',
  plan: 'premium',
  currency: 'USD',
  amount: 33900,
  paidAt: '2026-11-19T09:00:00.000Z',
  activateBy: '2026-11-26T09:00:00.000Z',
};
export const unpaid = (status: 'pending' | 'expired' | 'cancelled') => ({
  ...PAID,
  status,
  paidAt: null,
  activateBy: null,
});

/** The five values the payment provider appends to the return address, and what the page sends on from them. */
export const RETURN = {
  razorpay_payment_id: 'pay_Abc123',
  razorpay_payment_link_id: 'plink_Abc123',
  razorpay_payment_link_reference_id: ORDER_ID,
  razorpay_payment_link_status: 'paid',
  razorpay_signature: 'a'.repeat(64),
};
export const RETURN_QUERY = `?${new URLSearchParams(RETURN).toString()}`;
export const CONFIRM_BODY = {
  orderId: ORDER_ID,
  linkId: 'plink_Abc123',
  paymentId: 'pay_Abc123',
  status: 'paid',
  signature: 'a'.repeat(64),
};

export interface Answer {
  readonly status?: number;
  readonly body: unknown;
}
/** An answer, or `null` for a request that never gets one (the service out of reach). */
type Reply = Answer | null | ((request: Request, nth: number) => Answer | null);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };

/** Answers every request to `glob` and returns the requests it saw, in order. */
async function answer(page: Page, glob: string, reply: Reply): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(glob, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.push(request);
    const given = typeof reply === 'function' ? reply(request, seen.length) : reply;
    if (given === null) return route.abort('connectionrefused');
    return route.fulfill({
      status: given.status ?? 200,
      headers: CORS,
      contentType: 'application/json',
      body: typeof given.body === 'string' ? given.body : JSON.stringify(given.body),
    });
  });
  return seen;
}

export const mockQuote = (page: Page, reply: Reply = { body: LIST }) => answer(page, '**/v1/quote?*', reply);
export const mockCheckout = (page: Page, reply: Reply = { status: 201, body: CHECKOUT }) =>
  answer(page, '**/v1/checkout', reply);
export const mockConfirm = (page: Page, reply: Reply = { body: PAID }) =>
  answer(page, '**/v1/orders/confirm', reply);

/** The payment page: a plain page on the made-up host, so the test can see the browser arrive. */
export async function mockPayPage(page: Page): Promise<void> {
  await page.route('https://pay.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Payment page</title><h1>Payment page</h1>',
    }),
  );
}

/** The page's parts the specs look at. */
export const orderSection = (page: Page) => page.locator('[data-slot="premium-order"]');
export const orderForm = (page: Page) => page.locator('form[data-slot="order-form"]');
export const priceCard = (page: Page) => page.locator('[data-slot="premium-card"]');
export const thanks = (page: Page) => page.locator('[data-slot="premium-thanks"]');

/** Fills the three required fields (the number as +14155550100 unless one is given) and ticks the agreement. */
export async function fillOrder(
  page: Page,
  more: { whatsapp?: string; channel?: string } = {},
): Promise<void> {
  const form = orderForm(page);
  await form.getByLabel('Your name').fill('Asha Rao');
  await form.getByLabel('Your email').fill('asha@example.com');
  await form.getByLabel('WhatsApp number').fill(more.whatsapp ?? '+14155550100');
  if (more.channel !== undefined) await form.getByLabel('Your channel').fill(more.channel);
  await form.getByRole('checkbox').check();
}

export const submit = (page: Page) => orderForm(page).getByRole('button', { name: 'Continue to payment' });
