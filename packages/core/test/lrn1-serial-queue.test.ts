// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The one serial queue (LRN1-FIX): tasks one at a time, in call order; a failure is its caller's alone. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createKeyedQueue, createSerialQueue } from '../src/index';
import { deferred } from './helpers/bus';

/** Lets every pending reaction run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createSerialQueue', () => {
  it('starts each task once the one before it has settled, in call order', async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const first = deferred();
    const one = queue.run(async () => {
      order.push('one starts');
      await first.promise;
      order.push('one ends');
      return 1;
    });
    const two = queue.run(() => {
      order.push('two');
      return 2;
    });
    await flush();
    expect(order).toEqual(['one starts']);
    first.resolve();
    expect(await Promise.all([one, two])).toEqual([1, 2]);
    expect(order).toEqual(['one starts', 'one ends', 'two']);
  });

  it('gives a failure to its own caller only, and the next task still runs', async () => {
    const queue = createSerialQueue();
    const outcomes = await Promise.allSettled([
      queue.run(async () => Promise.reject(new Error('rejected'))),
      queue.run(() => {
        throw new Error('thrown');
      }),
      queue.run(async () => 'after'),
    ]);
    expect(
      outcomes.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value : String(outcome.reason))),
    ).toEqual(['Error: rejected', 'Error: thrown', 'after']);
  });

  it('resumes a caller awaiting its task before the next task starts', async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const one = queue.run(async () => 'one');
    const two = queue.run(() => void order.push('two starts'));
    const caller = (async () => {
      await one;
      order.push('caller of one resumes');
    })();
    await Promise.all([caller, two]);
    expect(order).toEqual(['caller of one resumes', 'two starts']);
  });

  it('settles once every task asked so far has, without rejecting for a failed one', async () => {
    const queue = createSerialQueue();
    await expect(queue.settled()).resolves.toBeUndefined();
    const first = deferred();
    const done: string[] = [];
    void queue.run(async () => {
      await first.promise;
      done.push('one');
    });
    const failed = queue.run(async () => Promise.reject(new Error('no')));
    let settled = false;
    const waiting = queue.settled().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    first.resolve();
    await waiting;
    expect(done).toEqual(['one']);
    await expect(failed).rejects.toThrow('no');
  });

  it('keeps no hold on the promise it hands back: a dropped failure is reported, not absorbed', () => {
    // In a process of its own, so the unhandled rejection is that process's, not this test run's.
    const source = fileURLToPath(new URL('../src/basics/serial-queue.ts', import.meta.url));
    const script = `
      const { createSerialQueue } = await import(${JSON.stringify(source)});
      process.on('unhandledRejection', (cause) => console.log('unhandled ' + cause.message));
      const queue = createSerialQueue();
      void queue.run(() => { throw new Error('dropped'); });
      console.log(await queue.run(() => 'next ran'));
      setTimeout(() => console.log('end'), 20);
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(out.trim().split('\n')).toEqual(['next ran', 'unhandled dropped', 'end']);
  });
});

describe('createKeyedQueue', () => {
  it('runs one task at a time per key, in call order, and different keys side by side', async () => {
    const queue = createKeyedQueue();
    const order: string[] = [];
    const a = deferred();
    const a1 = queue.run('a', async () => {
      order.push('a1 starts');
      await a.promise;
      order.push('a1 ends');
    });
    const a2 = queue.run('a', () => void order.push('a2'));
    const b1 = queue.run('b', () => void order.push('b1'));
    await flush();
    expect(order).toEqual(['a1 starts', 'b1']);
    a.resolve();
    await Promise.all([a1, a2, b1]);
    expect(order).toEqual(['a1 starts', 'b1', 'a1 ends', 'a2']);
  });

  it("gives a failure to its own caller only; the key's next task still runs", async () => {
    const queue = createKeyedQueue();
    const outcomes = await Promise.allSettled([
      queue.run('k', () => {
        throw new Error('first');
      }),
      queue.run('k', async () => 'second'),
    ]);
    expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: new Error('first') });
    expect(outcomes[1]).toEqual({ status: 'fulfilled', value: 'second' });
  });

  it('settles per key, or for every key, once the tasks asked so far have', async () => {
    const queue = createKeyedQueue();
    await expect(queue.settled()).resolves.toBeUndefined();
    await expect(queue.settled('none')).resolves.toBeUndefined();
    const a = deferred();
    const b = deferred();
    const done: string[] = [];
    void queue.run('a', async () => {
      await a.promise;
      done.push('a');
    });
    void queue.run('b', async () => {
      await b.promise;
      done.push('b');
    });
    const failed = queue.run('b', async () => Promise.reject(new Error('no')));
    const marks: string[] = [];
    const forA = queue.settled('a').then(() => marks.push('a settled'));
    const forAll = queue.settled().then(() => marks.push('all settled'));
    a.resolve();
    await forA;
    expect(marks).toEqual(['a settled']);
    b.resolve();
    await forAll;
    expect(done).toEqual(['a', 'b']);
    expect(marks).toEqual(['a settled', 'all settled']);
    await expect(failed).rejects.toThrow('no');
  });

  it('forgets a key once it is idle, so a later task under it starts at once', async () => {
    const queue = createKeyedQueue();
    await queue.run('k', async () => 'first');
    await flush();
    const order: string[] = [];
    const later = queue.run('k', () => void order.push('later'));
    const other = deferred();
    void queue.run('other', () => other.promise);
    await later;
    expect(order).toEqual(['later']);
    other.resolve();
  });
});
