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

/** Bindings and variables from wrangler.jsonc. The strings are checked by config/env.ts before any route runs. */
export interface HubEnv {
  RATINGS: D1Database;
  SUBMIT_BURST: RateLimitBinding;
  RATE_BURST: RateLimitBinding;
  READ_BURST: RateLimitBinding;
  HUB_REPO: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_INSTALLATION_ID: string;
  INSTALL_ID_SALT: string;
}
