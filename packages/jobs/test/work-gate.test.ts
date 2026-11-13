// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** UX2-DOWNLOADER round 2: what the component manager's close() waits for, and what it refuses after. */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { WorkGate } from '../src/components/work-gate';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe('the component manager’s work gate', () => {
  it('close resolves only once the work under way, and what it started, has finished', async () => {
    const gate = new WorkGate();
    const outer = deferred();
    const inner = deferred();
    const log: string[] = [];
    const running = gate.run(async () => {
      // Work started by work under way (an update's installs) is waited for too.
      void gate.runQuietly(async () => {
        await inner.promise;
        log.push('inner');
      });
      await outer.promise;
      log.push('outer');
      return ok('done');
    });
    let closed = false;
    const closing = gate.close().then(() => (closed = true));
    expect(gate.closed).toBe(true);
    outer.resolve();
    expect(await running).toEqual(ok('done'));
    await Promise.resolve();
    expect(closed).toBe(false);
    inner.resolve();
    await closing;
    expect(log).toEqual(['outer', 'inner']);
  });

  it('once closed, work that answers says core.cancelled and other work does nothing', async () => {
    const gate = new WorkGate();
    await gate.close();
    let ran = false;
    expect(
      await gate.run(async () => {
        ran = true;
        return ok(1);
      }),
    ).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    await gate.runQuietly(async () => {
      ran = true;
    });
    expect(ran).toBe(false);
  });
});
