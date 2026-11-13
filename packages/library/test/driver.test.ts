// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  betterSqlite3DriverFactory,
  createOrm,
  nodeSqliteDriver,
  openDatabase,
  projects,
  type SqliteDriverFactory,
} from '../src/index';
import { FakeBetterSqlite3 } from './fake-better-sqlite3';
import { tempDir } from './helpers';

const factories: [string, SqliteDriverFactory][] = [
  ['node:sqlite', nodeSqliteDriver],
  ['better-sqlite3 adapter', betterSqlite3DriverFactory(FakeBetterSqlite3)],
];

describe.each(factories)('%s driver', (_label, factory) => {
  it('binds integers as INTEGER and fractions as REAL', () => {
    const driver = factory.open(':memory:');
    const row = driver
      .prepare('SELECT typeof(?) AS a, typeof(?) AS b, typeof(?) AS c, typeof(?) AS d')
      .get(5, 5.5, 9n, null);
    expect(row).toEqual({ a: 'integer', b: 'real', c: 'integer', d: 'null' });
    driver.close();
  });

  it('round-trips text, numbers and blobs, as objects or arrays', () => {
    const driver = factory.open(':memory:');
    driver.exec('CREATE TABLE t (a TEXT, b INTEGER, c REAL, d BLOB)');
    driver.prepare('INSERT INTO t VALUES (?, ?, ?, ?)').run('x', 7, 1.25, new Uint8Array([1, 2, 3]));
    const object = driver.prepare('SELECT * FROM t').get()!;
    expect([object.a, object.b, object.c]).toEqual(['x', 7, 1.25]);
    expect([...(object.d as Uint8Array)]).toEqual([1, 2, 3]);
    expect(driver.prepare('SELECT a, b FROM t').values()).toEqual([['x', 7]]);
    // values() doesn't leave the cached statement in array mode.
    expect(driver.prepare('SELECT a, b FROM t').all()).toEqual([{ a: 'x', b: 7 }]);
    driver.close();
  });

  it('reuses prepared statements', () => {
    const driver = factory.open(':memory:');
    expect(driver.prepare('SELECT 1')).toBe(driver.prepare('SELECT 1'));
    driver.close();
  });

  it('classifies constraint, foreign key and corruption errors', () => {
    const driver = factory.open(':memory:');
    driver.exec(
      'PRAGMA foreign_keys = ON; CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (p TEXT REFERENCES p(id));',
    );
    driver.exec("INSERT INTO p VALUES ('a')");
    const kind = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        return driver.describeError(e)?.kind;
      }
      return 'no error';
    };
    expect(kind(() => driver.exec("INSERT INTO p VALUES ('a')"))).toBe('unique');
    expect(kind(() => driver.exec("INSERT INTO c VALUES ('zzz')"))).toBe('foreign_key');
    expect(driver.describeError(new TypeError('not sqlite'))).toBeUndefined();
    // Drizzle wraps driver errors; the cause chain is followed.
    const wrapped = new Error('outer', {
      cause: (() => {
        try {
          driver.exec("INSERT INTO p VALUES ('a')");
        } catch (e) {
          return e;
        }
      })(),
    });
    expect(driver.describeError(wrapped)?.kind).toBe('unique');
    driver.close();
  });

  it('reports SQLITE_BUSY when another connection holds the write lock', () => {
    const path = join(tempDir(), 'busy.db');
    const a = factory.open(path);
    const b = factory.open(path);
    a.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (x INTEGER)');
    b.exec('PRAGMA busy_timeout = 10');
    a.exec('BEGIN IMMEDIATE');
    try {
      b.exec('INSERT INTO t VALUES (1)');
      expect.unreachable();
    } catch (e) {
      expect(b.describeError(e)?.kind).toBe('busy');
    }
    a.exec('ROLLBACK');
    a.close();
    b.close();
  });

  it('runs the full open → migrate → query path', () => {
    const db = unwrap(openDatabase({ path: join(tempDir(), 'library.db'), driver: factory }));
    expect(db.driver.name).toBe(factory.name);
    db.orm
      .insert(projects)
      .values({ id: 'p1' as never, name: 'A', createdAt: 1, updatedAt: 1 })
      .run();
    expect(db.orm.select({ name: projects.name }).from(projects).all()).toEqual([{ name: 'A' }]);
    db.close();
  });
});

describe('Drizzle session', () => {
  function setup() {
    const driver = nodeSqliteDriver.open(':memory:');
    driver.exec(
      // The columns Drizzle's projects table writes (migration 15 added the last four).
      'CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ' +
        'archived_at INTEGER, last_opened_at INTEGER, budget_cap_micros INTEGER, budget_cap_currency TEXT)',
    );
    const orm = createOrm(driver);
    const add = (id: string) =>
      orm
        .insert(projects)
        .values({ id: id as never, name: id, createdAt: 0, updatedAt: 0 })
        .run();
    const ids = () =>
      orm
        .select({ id: projects.id })
        .from(projects)
        .all()
        .map((r) => r.id);
    return { driver, orm, add, ids };
  }

  it('commits a transaction and rolls one back on throw', () => {
    const { orm, add, ids } = setup();
    orm.transaction(() => add('a'));
    expect(() =>
      orm.transaction(() => {
        add('b');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(ids()).toEqual(['a']);
  });

  it('nests transactions as savepoints', () => {
    const { orm, add, ids } = setup();
    orm.transaction((tx) => {
      add('outer');
      expect(() =>
        tx.transaction(() => {
          add('inner');
          throw new Error('inner fails');
        }),
      ).toThrow();
      tx.transaction(() => add('sibling'));
    });
    expect(ids().sort()).toEqual(['outer', 'sibling']);
  });

  it('rolls back only the innermost level when calls re-enter from the root database', () => {
    const { orm, add, ids } = setup();
    orm.transaction(() => {
      add('a');
      orm.transaction(() => {
        add('b');
        expect(() =>
          orm.transaction(() => {
            add('c');
            throw new Error('innermost fails');
          }),
        ).toThrow();
        add('d');
      });
    });
    expect(ids().sort()).toEqual(['a', 'b', 'd']);
  });

  it('joins a transaction that is already open on the connection', () => {
    const { driver, orm, add, ids } = setup();
    driver.exec('BEGIN');
    orm.transaction(() => add('joined'));
    expect(driver.inTransaction).toBe(true);
    driver.exec('ROLLBACK');
    expect(ids()).toEqual([]);
  });

  it('refuses an async callback', () => {
    const { orm, driver } = setup();
    expect(() => orm.transaction((async () => undefined) as never)).toThrow(/synchronous/);
    expect(driver.inTransaction).toBe(false);
  });

  it('maps selected fields, raw sql and get()', () => {
    const { orm, add } = setup();
    add('x');
    expect(
      orm
        .select({ n: sql<number>`count(*)` })
        .from(projects)
        .get(),
    ).toEqual({ n: 1 });
    expect(orm.select().from(projects).get()).toMatchObject({
      id: 'x',
      name: 'x',
      createdAt: 0,
      updatedAt: 0,
    });
    expect(
      orm
        .select()
        .from(projects)
        .where(sql`0`)
        .get(),
    ).toBeUndefined();
    expect(orm.all(sql`SELECT id FROM projects`)).toEqual([{ id: 'x' }]);
  });
});
