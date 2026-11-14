// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Worker's variables and secrets, read once per request. There are three states, and each is an answer:
 *
 * - the variables are malformed: nothing can be priced, so every route is `billing.not_selling` (null here);
 * - the variables are sound but the key pair is missing, malformed or of the wrong mode: prices are quoted with
 *   `selling: false` and no order is taken (`provider` is null);
 * - both are sound: orders are taken while `SELLING` is `on`. Switching it `off` stops new orders only; payments
 *   already started are still confirmed.
 *
 * No value is ever echoed: a failure names nothing but its code.
 */
import { z } from 'zod';

import { readCatalog, type Catalog } from './catalog';

export type Mode = 'live' | 'test';

const origin = z.string().regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/);

const baseSchema = z.object({
  SITE_ORIGIN: origin,
  ALLOWED_ORIGINS: z.string().min(1).max(1000),
  MODE: z.enum(['live', 'test']),
  SELLING: z.enum(['on', 'off']),
});

const keySchema = z.object({
  RAZORPAY_KEY_ID: z.string().regex(/^rzp_(live|test)_[A-Za-z0-9]{6,40}$/),
  RAZORPAY_KEY_SECRET: z.string().min(10).max(200),
});

const mailSchema = z.object({
  OWNER_EMAIL: z.email(),
  MAIL_FROM: z.email(),
});

export interface ProviderKeys {
  keyId: string;
  keySecret: string;
}

export interface MailConfig {
  ownerEmail: string;
  from: string;
}

export interface BillingConfig {
  siteOrigin: string;
  allowedOrigins: ReadonlySet<string>;
  /** The mode this deployment sells in. Orders remember theirs. */
  mode: Mode;
  catalog: Catalog;
  /** The key pair, when it is set and is of this deployment's mode. */
  provider: ProviderKeys | null;
  /** New orders are taken. */
  selling: boolean;
  /** Signs the provider's deliveries. A different value from the key pair. */
  webhookSecret: string | null;
  /** Both addresses, when set: the email binding needs them. */
  mail: MailConfig | null;
  /** A chat webhook that takes `{ content, text }`, when set. */
  notifyWebhookUrl: string | null;
}

export function billingConfig(env: unknown): BillingConfig | null {
  const base = baseSchema.safeParse(env);
  if (!base.success) return null;
  const catalog = readCatalog(field(env, 'CATALOG'));
  if (!catalog) return null;
  const allowedOrigins = new Set<string>();
  for (const part of base.data.ALLOWED_ORIGINS.split(',')) {
    const value = part.trim();
    if (!origin.safeParse(value).success) return null;
    allowedOrigins.add(value);
  }

  const keys = keySchema.safeParse(env);
  // A test key on a live deployment (or the reverse) would hand visitors links from the wrong ledger.
  const provider =
    keys.success && keys.data.RAZORPAY_KEY_ID.startsWith(`rzp_${base.data.MODE}_`)
      ? { keyId: keys.data.RAZORPAY_KEY_ID, keySecret: keys.data.RAZORPAY_KEY_SECRET }
      : null;
  const mail = mailSchema.safeParse(env);
  return {
    siteOrigin: base.data.SITE_ORIGIN,
    allowedOrigins,
    mode: base.data.MODE,
    catalog,
    provider,
    selling: provider !== null && base.data.SELLING === 'on',
    webhookSecret: secret(field(env, 'RAZORPAY_WEBHOOK_SECRET'), 8),
    mail: mail.success ? { ownerEmail: mail.data.OWNER_EMAIL, from: mail.data.MAIL_FROM } : null,
    notifyWebhookUrl: httpsUrl(field(env, 'NOTIFY_WEBHOOK_URL')),
  };
}

function field(env: unknown, name: string): unknown {
  return typeof env === 'object' && env !== null ? Reflect.get(env, name) : undefined;
}

function secret(value: unknown, min: number): string | null {
  return typeof value === 'string' && value.length >= min && value.length <= 200 ? value : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500 || !URL.canParse(value)) return null;
  return new URL(value).protocol === 'https:' ? value : null;
}
