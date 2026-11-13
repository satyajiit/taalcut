// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** De-duplication by idempotency key, and the in-memory stores. */
import { err, newId, ok, unwrap } from '@taalcut/core';
import {
  createMemoryArtifactStore,
  createMemoryIdempotencyStore,
  createMemoryToolCache,
  type IdempotentOutcome,
  type ToolResult,
} from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { approvingPolicy, recordingBus, setup } from './helpers';

const rename = { id: 'c1', title: 'Sunset' };

describe('idempotency', () => {
  it('returns the first result for a repeat in the same run, without dispatching again', async () => {
    const { bus, calls } = recordingBus();
    const { executor, events } = setup({ commands: bus });
    const runId = newId<'AgentRun'>();
    const first = unwrap(await executor.execute('testdomain.renameClip', rename, { runId }));
    const second = unwrap(await executor.execute('testdomain.renameClip', rename, { runId }));
    expect(calls).toHaveLength(1);
    expect(second).toMatchObject({
      deduplicated: true,
      sameAs: first.callId,
      attempts: 0,
      value: first.value,
    });
    expect(second.callId).not.toBe(first.callId);
    expect(events.at(-1)).toMatchObject({ type: 'tool.finished', deduplicated: true });
  });

  it('treats the same action in another run as a new request', async () => {
    const { bus, calls } = recordingBus();
    const { executor } = setup({ commands: bus });
    unwrap(await executor.execute('testdomain.renameClip', rename, { runId: newId() }));
    unwrap(await executor.execute('testdomain.renameClip', rename, { runId: newId() }));
    expect(calls).toHaveLength(2);
  });

  it('coalesces concurrent identical calls (parallel tool calls from one model turn)', async () => {
    const { bus, calls } = recordingBus();
    const { policy, approvals } = approvingPolicy();
    const { executor } = setup({ commands: bus, policy });
    const runId = newId<'AgentRun'>();
    const [a, b] = await Promise.all([
      executor.execute('testdomain.deleteClip', { id: 'c2' }, { runId }),
      executor.execute('testdomain.deleteClip', { id: 'c2' }, { runId }),
    ]);
    expect(calls).toHaveLength(1);
    expect(approvals).toHaveLength(1);
    expect([unwrap(a).deduplicated, unwrap(b).deduplicated]).toEqual([false, true]);
    expect(unwrap(b).approvalId).toBe(unwrap(a).approvalId);
  });

  it('shares a definite failure with a concurrent twin but does not remember it', async () => {
    let fail = true;
    const { executor } = setup({
      commands: { dispatch: async () => (fail ? err(busDown()) : ok({})) },
    });
    const call = { runId: newId<'AgentRun'>() };
    const [a, b] = await Promise.all([
      executor.execute('testdomain.renameClip', rename, call),
      executor.execute('testdomain.renameClip', rename, call),
    ]);
    expect([a.ok, b.ok]).toEqual([false, false]);
    fail = false;
    expect(unwrap(await executor.execute('testdomain.renameClip', rename, call)).deduplicated).toBe(false);
  });

  it('uses an injected store, so the agent can back it with the run log', async () => {
    const stored = new Map<string, IdempotentOutcome>();
    const { bus, calls } = recordingBus();
    const idempotency = {
      get: async (key: string) => stored.get(key),
      set: async (key: string, outcome: IdempotentOutcome) => void stored.set(key, outcome),
    };
    const runId = newId<'AgentRun'>();
    unwrap(
      await setup({ commands: bus, idempotency }).executor.execute('testdomain.renameClip', rename, {
        runId,
      }),
    );
    // A new executor (say, after a restart) sees the completed call and does not dispatch again.
    const again = await setup({ commands: bus, idempotency }).executor.execute(
      'testdomain.renameClip',
      rename,
      {
        runId,
      },
    );
    expect(unwrap(again).deduplicated).toBe(true);
    expect(calls).toHaveLength(1);
    expect([...stored.keys()]).toEqual([`${runId}:testdomain.renameClip:c1:Sunset`]);
  });
});

function busDown() {
  return { code: 'fx.bus_down', messageKey: 'errors.fx.bus_down', retryable: false };
}

describe('memory stores', () => {
  it('evicts the least recently used entries', async () => {
    const store = createMemoryIdempotencyStore({ maxEntries: 2 });
    const result: IdempotentOutcome = { ok: true, result: { tool: 't' } as ToolResult };
    await store.set('a', result);
    await store.set('b', result);
    await store.get('a');
    await store.set('c', result);
    expect([await store.get('a'), await store.get('b'), await store.get('c')]).toEqual([
      result,
      undefined,
      result,
    ]);
  });

  it('expires cache entries after their ttl and keeps others forever', async () => {
    let now = 0;
    const cache = createMemoryToolCache({ now: () => now, maxEntries: 10 });
    const entry = { value: 1, output: { kind: 'inline' as const, value: 1 } };
    await cache.set('short', entry, 10);
    await cache.set('forever', entry);
    now = 10;
    expect(await cache.get('short')).toBeUndefined();
    expect(await cache.get('forever')).toEqual(entry);
    expect(await cache.get('missing')).toBeUndefined();
    expect(await createMemoryToolCache().get('x')).toBeUndefined();
  });

  it('stores artifacts from strings or bytes and reports missing ones', async () => {
    const artifacts = createMemoryArtifactStore();
    const text = unwrap(await artifacts.put({ mediaType: 'text/plain', data: 'héllo', summary: 'greeting' }));
    expect(text).toMatchObject({ mediaType: 'text/plain', bytes: 6, summary: 'greeting' });
    const bytes = unwrap(
      await artifacts.put({ mediaType: 'image/png', data: new Uint8Array([1, 2]), summary: 'png' }),
    );
    expect(unwrap(await artifacts.get(bytes.id)).data).toEqual(new Uint8Array([1, 2]));
    const missing = await artifacts.get(newId());
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });
});
