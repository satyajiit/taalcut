// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Helpers every repository uses to turn SQLite failures into Results. */
import { err, NotFoundError, ok, type Err, type Result, type TaalcutError } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { fromDriverError } from '../errors';

class Rollback {
  constructor(readonly result: Err<TaalcutError>) {}
}

function toResult<T>(db: LibraryDatabase, entity: string, cause: unknown): Result<T> {
  if (cause instanceof Rollback) return cause.result;
  // Anything that isn't a SQLite error is a bug: let it throw.
  if (!db.driver.describeError(cause)) throw cause;
  return err(fromDriverError(db.driver, cause, entity));
}

/**
 * Runs `fn` in an IMMEDIATE transaction (a savepoint if one is already open).
 * An Err from `fn` rolls back and is returned; a SQLite error becomes an Err.
 */
export function inTransaction<T>(db: LibraryDatabase, entity: string, fn: () => Result<T>): Result<T> {
  try {
    return db.transaction(() => {
      const result = fn();
      if (!result.ok) throw new Rollback(result);
      return result;
    });
  } catch (cause) {
    return toResult(db, entity, cause);
  }
}

/** Runs a single write; a SQLite error becomes an Err. */
export function attemptWrite<T>(db: LibraryDatabase, entity: string, fn: () => T): Result<T> {
  try {
    return ok(fn());
  } catch (cause) {
    return toResult(db, entity, cause);
  }
}

export function missing(entity: string, id: string): Err<TaalcutError> {
  return err(NotFoundError({ entity, id }));
}

/** ok(row) or NotFoundError for `entity`. */
export function found<T>(row: T | undefined, entity: string, id: string): Result<T> {
  return row === undefined ? missing(entity, id) : ok(row);
}

/** ok() if a write touched a row, else NotFoundError. */
export function touched(changes: number, entity: string, id: string): Result<void> {
  return changes === 0 ? missing(entity, id) : ok(undefined);
}

/** Clamps a caller-supplied page size. */
export function pageSize(limit: number | undefined, fallback = 100, max = 1000): number {
  if (limit === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}
