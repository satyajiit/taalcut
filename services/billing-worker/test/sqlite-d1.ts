// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { type D1Database, type D1PreparedStatement, type D1Value } from '../src/store/d1';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const TABLES = ['orders', 'provider_events', 'day_counts'] as const;

/** D1's statement API over an in-memory SQLite database with the Worker's migrations applied: the real SQL runs. */
export class SqliteD1 implements D1Database {
  private readonly db = new DatabaseSync(':memory:');

  constructor() {
    for (const name of readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      this.db.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
    }
  }

  prepare(query: string): D1PreparedStatement {
    return this.statement(query, []);
  }

  /** Every row of every table, to check what is (and isn't) stored. */
  snapshot(): Record<string, unknown[]> {
    return Object.fromEntries(
      TABLES.map((table) => [table, this.db.prepare(`SELECT * FROM ${table}`).all()]),
    );
  }

  private statement(query: string, values: readonly D1Value[]): D1PreparedStatement {
    return {
      bind: (...next) => this.statement(query, next),
      run: async () => this.db.prepare(query).run(...values),
      first: async () => this.db.prepare(query).get(...values) ?? null,
      all: async () => ({ results: this.db.prepare(query).all(...values) }),
    };
  }
}
