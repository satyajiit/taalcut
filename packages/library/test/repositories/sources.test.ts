// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sources the library keeps its own files under (stock downloads, generated files): one per kind and originals
 * root, made on first use, online and not watched; the oldest when an earlier version left several.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createSourceRepository, managedSource } from '../../src/repositories/sources';
import { fakeClock, openTestDb } from '../helpers';

describe('managed sources', () => {
  it('makes the source on first use and finds it after', () => {
    const db = openTestDb({ file: false });
    const id = unwrap(managedSource(db, 'generated', 'Generated', '/Originals'));
    expect(unwrap(managedSource(db, 'generated', 'Generated', '/Originals'))).toBe(id);
    expect(unwrap(createSourceRepository(db).get(id))).toMatchObject({
      kind: 'generated',
      displayName: 'Generated',
      rootPath: '/Originals',
      status: 'online',
      watch: false,
    });
    expect(createSourceRepository(db).list()).toHaveLength(1);
  });

  it('keeps one per kind and per root', () => {
    const db = openTestDb({ file: false });
    const generated = unwrap(managedSource(db, 'generated', 'Generated', '/Originals'));
    const stock = unwrap(managedSource(db, 'stock_import', 'Stock', '/Originals'));
    const elsewhere = unwrap(managedSource(db, 'stock_import', 'Stock', '/Volumes/Media/Originals'));
    expect(new Set([generated, stock, elsewhere]).size).toBe(3);
  });

  it('takes the oldest when there are several', () => {
    const clock = fakeClock();
    const db = openTestDb({ file: false, clock: clock.now });
    const sources = createSourceRepository(db);
    const add = () =>
      unwrap(
        sources.add({ kind: 'stock_import', displayName: 'Stock', rootPath: '/Originals', watch: false }),
      ).id;
    const first = add();
    clock.advance(1);
    add();
    expect(unwrap(managedSource(db, 'stock_import', 'Stock', '/Originals'))).toBe(first);
  });

  it('refuses a root that is not absolute', () => {
    const db = openTestDb({ file: false });
    const added = managedSource(db, 'generated', 'Generated', 'Originals');
    expect(added.ok ? undefined : added.error.code).toBe('core.validation');
  });
});
