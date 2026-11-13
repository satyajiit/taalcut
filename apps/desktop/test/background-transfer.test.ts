// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { createBackgroundTransferOwner } from '../src/main/transfer/background-transfer';

it('keeps Wi-Fi reception alive after a renderer reload and quiesces on app shutdown', async () => {
  const owner = createBackgroundTransferOwner();
  let sourceSignal: AbortSignal | undefined;
  let opens = 0;
  const client = owner.wrap({
    transfer: {
      async *open(_input: object, options: { signal: AbortSignal }) {
        opens += 1;
        sourceSignal = options.signal;
        yield {
          type: 'session',
          session: { id: 'fixture', state: 'listening' },
          pairing: { code: 'fixture-code' },
        };
        yield { type: 'session', session: { id: 'fixture', state: 'listening' } };
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
    },
  });
  const viewer = new AbortController();
  const stream = await client.transfer.open({}, { signal: viewer.signal });
  const iterator = stream[Symbol.asyncIterator]();
  expect((await iterator.next()).done).toBe(false);
  viewer.abort();
  await iterator.return?.();
  expect(sourceSignal?.aborted).toBe(false);
  const reattached = await client.transfer.open({}, { signal: new AbortController().signal });
  const again = reattached[Symbol.asyncIterator]();
  expect((await again.next()).value).toMatchObject({
    type: 'session',
    session: { id: 'fixture' },
    pairing: { code: 'fixture-code' },
  });
  expect(opens).toBe(1);
  await again.return?.();
  await owner.close();
  expect(sourceSignal?.aborted).toBe(true);
});

it('does not let a delayed Stop close a newer reception', async () => {
  const owner = createBackgroundTransferOwner();
  const signals: AbortSignal[] = [];
  const finish: (() => void)[] = [];
  let finishClose!: () => void;
  const client = owner.wrap({
    transfer: {
      async *open(_input: object, options: { signal: AbortSignal }) {
        const index = signals.push(options.signal) - 1;
        const ended = new Promise<void>((resolve) => {
          finish[index] = resolve;
          options.signal.addEventListener('abort', resolve.bind(undefined, undefined), { once: true });
        });
        yield { type: 'session', session: { id: `fixture-${index}`, state: 'listening' } };
        await ended;
      },
      close: () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    },
  });
  const first = (await client.transfer.open({}, { signal: new AbortController().signal }))[
    Symbol.asyncIterator
  ]();
  await first.next();
  const stopping = client.transfer.close();
  finish[0]!();
  expect((await first.next()).done).toBe(true);
  const second = (await client.transfer.open({}, { signal: new AbortController().signal }))[
    Symbol.asyncIterator
  ]();
  await second.next();
  finishClose();
  await stopping;
  expect(signals[1]?.aborted).toBe(false);
  await owner.close();
  await second.return?.();
});
