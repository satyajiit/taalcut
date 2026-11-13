// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Pieces both drivers share: parameter binding and a small statement cache. */
import type { SqlValue } from './types';

/**
 * Both drivers would bind a JS number like 5 as REAL. Safe integers go in as
 * INTEGER (BigInt) instead, so integer-only contexts (vec0 rowids, LIMIT) and
 * `typeof(x)` behave the same on either driver.
 */
export function bindParams(params: readonly SqlValue[]): SqlValue[] {
  return params.map((p) => (typeof p === 'number' && Number.isSafeInteger(p) ? BigInt(p) : p));
}

/** Least-recently-used cache of prepared statements keyed by SQL text. */
export class StatementCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly capacity = 256) {}

  getOrCreate(sql: string, create: (sql: string) => T): T {
    const hit = this.entries.get(sql);
    if (hit !== undefined) {
      this.entries.delete(sql);
      this.entries.set(sql, hit);
      return hit;
    }
    const created = create(sql);
    this.entries.set(sql, created);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return created;
  }

  clear(): void {
    this.entries.clear();
  }
}
