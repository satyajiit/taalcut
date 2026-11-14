// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type BillingConfig } from './config/env';
import { type Notifier } from './notify/notifier';
import { type PaymentProvider } from './razorpay/port';
import { type D1Database, type RateLimitBinding } from './store/d1';

/** What one request (or one scheduled run) works with. index.ts builds it; nothing here is shared state. */
export interface BillingDeps {
  db: D1Database;
  config: BillingConfig;
  /** Null when the key pair is not set or is of the wrong mode. */
  provider: PaymentProvider | null;
  notifier: Notifier;
  checkoutBurst: RateLimitBinding;
  readBurst: RateLimitBinding;
  now: () => number;
  /** Work that may finish after the answer is sent (telling people about a paid order). */
  defer(work: Promise<unknown>): void;
}
