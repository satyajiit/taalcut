// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The slice of D1 the stores use. Miniflare's D1 and the tests' SQLite double both satisfy it. Rows come back
 * as `unknown`: every store parses its rows with zod, so nothing read from the database is trusted by shape.
 */
export type D1Value = string | number | null;

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  run(): Promise<unknown>;
  /** The first row, or null when there is none. */
  first(): Promise<unknown>;
  all(): Promise<{ results: unknown[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The part of the email binding the Worker calls. */
export interface EmailBinding {
  send(message: {
    to: string;
    from: { email: string; name: string };
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/**
 * Bindings, variables and secrets from wrangler.jsonc. config/env.ts checks the strings before any route runs; the
 * secrets are optional here because a Worker without them still answers, as "not selling".
 */
export interface BillingEnv {
  ORDERS: D1Database;
  CHECKOUT_BURST: RateLimitBinding;
  READ_BURST: RateLimitBinding;
  EMAIL?: EmailBinding;
  SITE_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  MODE: string;
  SELLING: string;
  CATALOG: unknown;
  OWNER_EMAIL?: string;
  MAIL_FROM?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  NOTIFY_WEBHOOK_URL?: string;
}
