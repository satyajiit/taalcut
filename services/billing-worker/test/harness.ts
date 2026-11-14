// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { createBillingWorker } from '../src/index';
import { hmacHex, returnMessage } from '../src/razorpay/signature';
import { type BillingEnv, type EmailBinding, type RateLimitBinding } from '../src/store/d1';
import { FakeProvider } from './fake-provider';
import { SqliteD1 } from './sqlite-d1';

export const SITE = 'https://taalcut.app';
export const API = 'https://billing.taalcut.app';
export const KEY_ID = 'rzp_live_AbCdEf123456';
export const TEST_KEY_ID = 'rzp_test_AbCdEf123456';
export const KEY_SECRET = 'test-key-secret-not-a-secret';
export const WEBHOOK_SECRET = 'test-webhook-secret-not-a-secret';
/** The day before the launch offers start. */
export const BEFORE_LAUNCH = Date.parse('2026-11-18T00:00:00Z');
/** Two hours into launch day: both launch offers run. */
export const LAUNCH_DAY = Date.parse('2026-11-19T10:00:00Z');
/** Launch week, after launch day: only the Product Hunt offer runs. */
export const LAUNCH_WEEK = Date.parse('2026-11-22T10:00:00Z');

export const CATALOG = {
  plans: { premium: { label: 'Taalcut Premium', prices: { USD: 40000, INR: 3760000 } } },
  currencyByCountry: { IN: 'INR' },
  offers: [
    {
      id: 'product-hunt',
      plan: 'premium',
      currency: 'USD',
      amount: 33900,
      code: 'producthunt',
      startsAt: '2026-11-19T08:01:00Z',
      endsAt: '2026-11-26T08:01:00Z',
    },
    {
      id: 'launch-day',
      plan: 'premium',
      currency: 'USD',
      amount: 33900,
      startsAt: '2026-11-19T08:01:00Z',
      endsAt: '2026-11-20T08:01:00Z',
    },
    {
      id: 'product-hunt',
      plan: 'premium',
      currency: 'INR',
      amount: 3186600,
      code: 'producthunt',
      startsAt: '2026-11-19T08:01:00Z',
      endsAt: '2026-11-26T08:01:00Z',
    },
    {
      id: 'launch-day',
      plan: 'premium',
      currency: 'INR',
      amount: 3186600,
      startsAt: '2026-11-19T08:01:00Z',
      endsAt: '2026-11-20T08:01:00Z',
    },
  ],
};

export interface SentEmail {
  to: string;
  from: { email: string; name: string };
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export interface TestBilling {
  env: BillingEnv;
  db: SqliteD1;
  provider: FakeProvider;
  emails: SentEmail[];
  /** Bodies posted to the chat webhook. */
  chats: string[];
  clock: { now: number };
  /** Where Cloudflare says a request comes from. Null: it does not say. */
  visitor: { country: string | null };
  /** Switches the mailbox and the chat webhook off and on during a test. */
  mail: { fails: boolean; chatFails: boolean };
  request(path: string, init?: RequestInit): Promise<Response>;
  /** A JSON POST from the website's page. */
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
  /** Runs the scheduled sweep. */
  sweep(): Promise<void>;
  /** Waits for work the Worker left running after its answer. */
  settled(): Promise<void>;
}

/** The ratelimits binding's contract: at most `limit` calls per key in any `periodMs`. */
export function createBurstLimiter(limit: number, periodMs: number, now: () => number): RateLimitBinding {
  const hits = new Map<string, number[]>();
  return {
    async limit({ key }) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < periodMs);
      const success = recent.length < limit;
      if (success) recent.push(at);
      hits.set(key, recent);
      return { success };
    },
  };
}

export interface TestOptions {
  now?: number;
  /** Variables and secrets to change or remove (undefined removes). */
  env?: Partial<Record<keyof BillingEnv, unknown>>;
  checkoutLimit?: number;
  readLimit?: number;
  /** No email binding: only the chat webhook can tell us. */
  noEmail?: boolean;
  /** The email binding throws. */
  emailFails?: boolean;
  /** The chat webhook answers 500. */
  chatFails?: boolean;
}

/** A Worker over SQLite D1, a fake payment provider, a fake mailbox and a fake chat webhook. */
export function createTestBilling(options: TestOptions = {}): TestBilling {
  const clock = { now: options.now ?? BEFORE_LAUNCH };
  const now = (): number => clock.now;
  const db = new SqliteD1();
  const provider = new FakeProvider(now);
  const emails: SentEmail[] = [];
  const chats: string[] = [];
  const pending: Promise<unknown>[] = [];
  const mail = { fails: options.emailFails ?? false, chatFails: options.chatFails ?? false };

  const mailbox: EmailBinding = {
    async send(message) {
      if (mail.fails) throw new Error('mail is down');
      emails.push(message);
      return { messageId: `m${emails.length}` };
    },
  };
  const base: BillingEnv = {
    ORDERS: db,
    CHECKOUT_BURST: createBurstLimiter(options.checkoutLimit ?? 100, 60_000, now),
    READ_BURST: createBurstLimiter(options.readLimit ?? 100, 60_000, now),
    ...(options.noEmail ? {} : { EMAIL: mailbox }),
    SITE_ORIGIN: SITE,
    ALLOWED_ORIGINS: SITE,
    MODE: 'live',
    SELLING: 'on',
    CATALOG,
    OWNER_EMAIL: 'owner@example.com',
    MAIL_FROM: 'premium@taalcut.app',
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    NOTIFY_WEBHOOK_URL: 'https://chat.example/hook',
  };
  const env: BillingEnv = { ...base };
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) Reflect.deleteProperty(env, name);
    else Reflect.set(env, name, value);
  }

  const fetchFake: typeof fetch = async (_input, init) => {
    if (typeof init?.body === 'string') chats.push(init.body);
    return new Response(null, { status: mail.chatFails ? 500 : 204 });
  };
  const worker = createBillingWorker({ provider: () => provider, fetch: fetchFake, now });
  const ctx = { waitUntil: (work: Promise<unknown>) => void pending.push(work) };

  const visitor: { country: string | null } = { country: null };
  const request = (path: string, init?: RequestInit): Promise<Response> => {
    const made = new Request(`${API}${path}`, init);
    // Cloudflare writes what it knows about the visitor on the request itself.
    if (visitor.country !== null) Object.defineProperty(made, 'cf', { value: { country: visitor.country } });
    return worker.fetch(made, env, ctx);
  };
  return {
    env,
    db,
    provider,
    emails,
    chats,
    clock,
    visitor,
    mail,
    request,
    post: (path, body, headers) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: SITE, ...headers },
        body: JSON.stringify(body),
      }),
    sweep: () => worker.scheduled({}, env, ctx),
    async settled() {
      while (pending.length > 0) await pending.shift();
    },
  };
}

export const BUYER = {
  plan: 'premium',
  name: 'Asha Rao',
  email: 'asha@example.com',
  whatsapp: '+1 (415) 555-0100',
  channel: 'https://www.instagram.com/asha.makes/',
  agreed: true,
};

export interface PlacedOrder {
  orderId: string;
  linkId: string;
  payUrl: string;
  amount: number;
}

/** Places an order and returns what the page and the provider would each know. */
export async function placeOrder(
  billing: TestBilling,
  extra?: Record<string, unknown>,
): Promise<PlacedOrder> {
  const response = await billing.post('/v1/checkout', { ...BUYER, ...extra });
  if (response.status !== 201)
    throw new Error(`checkout answered ${response.status}: ${await response.text()}`);
  const made = z
    .object({ orderId: z.string(), payUrl: z.string(), amount: z.number() })
    .parse(await response.json());
  return { ...made, linkId: made.payUrl.slice(made.payUrl.lastIndexOf('/') + 1) };
}

/** The body the thanks page posts: the provider's five return values, signed as the provider signs them. */
export async function returnBody(
  order: PlacedOrder,
  paymentId: string,
  change?: Partial<{ orderId: string; linkId: string; paymentId: string; status: string; secret: string }>,
): Promise<Record<string, string>> {
  const values = { orderId: order.orderId, linkId: order.linkId, paymentId, status: 'paid', ...change };
  const signature = await hmacHex(change?.secret ?? KEY_SECRET, returnMessage(values));
  return {
    orderId: values.orderId,
    linkId: values.linkId,
    paymentId: values.paymentId,
    status: values.status,
    signature,
  };
}

/** A delivery to the webhook about `linkId`, signed as the provider signs it. */
export async function delivery(
  billing: TestBilling,
  linkId: string,
  options?: { event?: string; eventId?: string | null; secret?: string; body?: string },
): Promise<Response> {
  const body =
    options?.body ??
    JSON.stringify({
      event: options?.event ?? 'payment_link.paid',
      payload: { payment_link: { entity: { id: linkId, amount: 1, status: 'paid' } } },
    });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-razorpay-signature': await hmacHex(options?.secret ?? WEBHOOK_SECRET, body),
  };
  if (options?.eventId !== null) headers['x-razorpay-event-id'] = options?.eventId ?? `evt_${linkId}`;
  return billing.request('/v1/razorpay/webhook', { method: 'POST', headers, body });
}
