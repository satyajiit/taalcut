// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  all,
  andThen,
  attempt,
  attemptAsync,
  CancelledError,
  defineError,
  definedErrorCodes,
  err,
  idSchema,
  idTime,
  isErr,
  isId,
  isOk,
  isTaalcutError,
  map,
  mapErr,
  newId,
  ok,
  parseId,
  ProcessRestartedError,
  toTaalcutError,
  UnknownError,
  unwrap,
  unwrapOr,
  UnwrapError,
  ValidationError,
  type ProjectId,
} from '@taalcut/core';

describe('Result', () => {
  it('maps and chains values and passes errors through', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err('x'), (n: number) => n * 3)).toEqual(err('x'));
    expect(mapErr(err('x'), (e) => e.toUpperCase())).toEqual(err('X'));
    expect(mapErr(ok(1), (e: string) => e)).toEqual(ok(1));
    expect(andThen(ok(2), (n) => (n > 1 ? ok(n) : err('small')))).toEqual(ok(2));
    expect(andThen(err('e'), (n: number) => ok(n))).toEqual(err('e'));
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err(1))).toBe(true);
    expect(unwrapOr(err('e'), 5)).toBe(5);
    expect(unwrapOr(ok(1), 5)).toBe(1);
  });

  it('unwrap throws on Err, wrapping non-Error values', () => {
    expect(unwrap(ok('v'))).toBe('v');
    expect(() => unwrap(err(new RangeError('boom')))).toThrow(RangeError);
    expect(() => unwrap(err(CancelledError()))).toThrow(UnwrapError);
    expect(() => unwrap(err(CancelledError()))).toThrow(/core\.cancelled/);
  });

  it('turns throws and rejections into errors', async () => {
    expect(attempt(() => 1)).toEqual(ok(1));
    const thrown = attempt(() => {
      throw new Error('bad');
    });
    expect(thrown.ok).toBe(false);
    expect(!thrown.ok && thrown.error.code).toBe('core.unknown');
    expect(!thrown.ok && thrown.error.detail).toBe('Error'); // the name only, never the message
    expect(await attemptAsync(async () => 2)).toEqual(ok(2));
    const rejected = await attemptAsync(() => Promise.reject(new DOMException('stop', 'AbortError')));
    expect(!rejected.ok && rejected.error.code).toBe('core.cancelled');
  });

  it('collects results with all()', () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err('first'), err('second')])).toEqual(err('first'));
  });
});

describe('errors', () => {
  it('builds serialisable errors with a message key, params and fix', () => {
    const DiskFull = defineError<{ path: string }>('test.disk_full', {
      fix: { command: 'settings.openStorage', labelKey: 'fix.freeSpace' },
    });
    const e = DiskFull({ path: '/Volumes/X' }, { detail: 'ENOSPC' });
    expect(e).toEqual({
      code: 'test.disk_full',
      messageKey: 'errors.test.disk_full',
      retryable: false,
      params: { path: '/Volumes/X' },
      fix: { command: 'settings.openStorage', labelKey: 'fix.freeSpace' },
      detail: 'ENOSPC',
    });
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    expect(DiskFull.is(e)).toBe(true);
    expect(DiskFull.is(CancelledError())).toBe(false);
    expect(definedErrorCodes()).toContain('test.disk_full');
  });

  it('rejects bad and duplicate codes', () => {
    expect(() => defineError('NoNamespace')).toThrow(/Invalid error code/);
    expect(() => defineError('core.cancelled')).toThrow(/defined twice/);
  });

  it('marks restart errors retryable and recognises error shapes', () => {
    expect(ProcessRestartedError({ process: 'agent' }).retryable).toBe(true);
    expect(isTaalcutError(CancelledError())).toBe(true);
    expect(isTaalcutError({ code: 'x' })).toBe(false);
    expect(isTaalcutError(null)).toBe(false);
    expect(toTaalcutError(CancelledError())).toEqual(CancelledError());
    expect(toTaalcutError('plain').detail).toBe('thrown string');
  });

  it('never copies a thrown message or value into detail (review 2: it crosses IPC)', () => {
    const secret = `sk-live-${'SECRETTOKEN'.repeat(2)}`;
    const db = new TypeError(`postgres://app_user:${secret}@db-prod.internal/taalcut`);
    expect(toTaalcutError(db)).toEqual(UnknownError(undefined, { detail: 'TypeError' }));
    expect(JSON.stringify(toTaalcutError(secret))).not.toContain(secret);
    const named = Object.assign(new Error('x'), { name: `Bearer ${secret}` });
    expect(toTaalcutError(named).detail).toBe('Error');
    const bad = parseId(secret);
    expect(!bad.ok && bad.error).toEqual(ValidationError({ field: 'id' }, { detail: 'Expected a ULID' }));
  });
});

describe('ids', () => {
  it('makes sortable, valid, timestamped ULIDs', () => {
    const before = Date.now();
    const ids = Array.from({ length: 1000 }, () => newId<'Project'>());
    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every(isId)).toBe(true);
    expect(idTime(ids[0]!)).toBeGreaterThanOrEqual(before - 1);
  });

  it('parses untrusted ids', () => {
    const id: ProjectId = newId();
    expect(parseId<'Project'>(id)).toEqual(ok(id));
    const bad = parseId('not-an-id');
    expect(!bad.ok && bad.error.code).toBe('core.validation');
    expect(isId(42)).toBe(false);
  });

  it('validates ids in zod contracts', () => {
    const schema = idSchema<'Project'>();
    const id = newId<'Project'>();
    expect(schema.parse(id)).toBe(id);
    expect(schema.safeParse('nope').success).toBe(false);
  });
});
