// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, unwrap, ValidationError } from '@taalcut/core';
import { expect, it } from 'vitest';
import { importer } from './fixture';

it('binds the sink to the same volume budget used by local imports and refuses competing admission', async () => {
  const held = new Map<string, number>();
  let volume = '';
  const space = {
    reserved: () => [...held.values()].reduce((sum, bytes) => sum + bytes, 0),
    async reserve(owner: string, next: string, _destination: string, bytes: number) {
      volume = next;
      if (space.reserved() + bytes > 100) return err(ValidationError({ field: 'space' }));
      held.set(owner, (held.get(owner) ?? 0) + bytes);
      return ok(undefined);
    },
    consume(owner: string, bytes: number) {
      held.set(owner, Math.max(0, (held.get(owner) ?? 0) - bytes));
    },
    release(owner: string) {
      held.delete(owner);
    },
  };
  const fx = await importer({ space });
  held.set('local-session', 80);
  const rejected = await fx.sink.space!.reserve('phone-upload', 30);
  expect(rejected.ok).toBe(false);
  held.delete('local-session');
  unwrap(await fx.sink.space!.reserve('phone-upload', 30));
  expect(volume.length).toBeGreaterThan(0);
  fx.sink.space!.consume('phone-upload', 10);
  expect(held.get('phone-upload')).toBe(20);
  fx.sink.space!.release('phone-upload');
  expect(space.reserved()).toBe(0);
});

it('binds destination holds to the same eject barrier and preserves nested sink holds', async () => {
  const { createImportReaderRegistry } = await import('../../src/index');
  const fx = await importer();
  const release = unwrap(await fx.sink.retainDestination!('phone-session'));
  const volume = String(fx.db.driver.prepare('SELECT volume FROM import_volume_readers').get()!.volume);
  const readers = createImportReaderRegistry(fx.db);
  expect((await readers.eject(volume, async () => ok(undefined))).ok).toBe(false);
  unwrap(await fx.sink.importStaged(fx.stage('take.mov').file));
  expect(readers.count(volume)).toBe(1);
  release();
  expect((await readers.eject(volume, async () => ok(undefined))).ok).toBe(true);
});
