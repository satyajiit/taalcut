// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** createCommandDispatcher over core's real command bus and in-memory audit log. */
import {
  agentTurnGroup,
  createCommandBus,
  ConflictError,
  err,
  createMemoryAuditLogStore,
  defineCommand,
  newId,
  ok,
  unwrap,
  type RunId,
  type ToolRunId,
} from '@taalcut/core';
import { createCommandDispatcher } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

function setup() {
  const store = createMemoryAuditLogStore();
  const bus = createCommandBus({ store, clock: { now: () => 1 } });
  const applied: string[] = [];
  bus.register(
    defineCommand({
      name: 'clips.rename',
      payload: z.object({ id: z.string(), title: z.string() }),
      sideEffect: 'write',
      handle: (payload) => {
        applied.push(payload.title);
        return ok({ result: { renamed: payload.id } });
      },
    }),
  );
  return { store, applied, bus, dispatcher: createCommandDispatcher(bus) };
}

const meta = (extra: { runId?: RunId; idempotencyKey?: string; signal?: AbortSignal } = {}) => ({
  source: 'agent' as const,
  toolCallId: newId<'ToolRun'>() as ToolRunId,
  tool: 'clips.rename',
  ...extra,
});

describe('the command dispatcher over core’s bus', () => {
  it('runs as the agent of the run, returns the handler result, and audits it', async () => {
    const { store, applied, dispatcher } = setup();
    const runId = newId<'AgentRun'>();
    const result = await dispatcher.dispatch('clips.rename', { id: 'c1', title: 'Sunset' }, meta({ runId }));
    expect(unwrap(result)).toEqual({ renamed: 'c1' });
    expect(applied).toEqual(['Sunset']);
    expect(store.entries()[0]).toMatchObject({
      source: 'agent',
      actor: `agent:${runId}`,
      sideEffect: 'write',
    });
  });

  it('verifies after durable commit and reports a failed verification without applying again', async () => {
    const { store, bus, applied } = setup();
    const dispatcher = createCommandDispatcher(bus, async (command, result) => {
      expect(command).toBe('clips.rename');
      expect(result).toEqual({ renamed: 'c1' });
      expect(store.entries()).toHaveLength(1);
      return err(ConflictError({ entity: 'timeline', id: 'c1' }));
    });
    const result = await dispatcher.dispatch('clips.rename', { id: 'c1', title: 'A' }, meta());
    expect(result).toMatchObject({ ok: false, error: { code: 'core.conflict' } });
    expect(applied).toEqual(['A']);
  });

  it('passes the idempotency key on, so a repeated key is not applied twice', async () => {
    const { store, applied, dispatcher } = setup();
    const key = { idempotencyKey: 'run-1:clips.rename:c1' };
    unwrap(await dispatcher.dispatch('clips.rename', { id: 'c1', title: 'A' }, meta(key)));
    const again = await dispatcher.dispatch('clips.rename', { id: 'c1', title: 'A' }, meta(key));
    expect(unwrap(again)).toEqual({ renamed: 'c1' });
    expect(applied).toEqual(['A']);
    expect(store.entries()).toHaveLength(1);
    expect(store.entries()[0]?.actor).toBe('agent');
  });

  it('does not start a command once the attempt is aborted, and passes bus errors through', async () => {
    const { applied, dispatcher } = setup();
    const stopped = await dispatcher.dispatch(
      'clips.rename',
      { id: 'c1', title: 'A' },
      meta({ signal: AbortSignal.abort() }),
    );
    expect(!stopped.ok && stopped.error.code).toBe('core.cancelled');
    const unknown = await dispatcher.dispatch('clips.teleport', {}, meta());
    expect(!unknown.ok && unknown.error.code).toBe('core.not_found');
    expect(applied).toEqual([]);
  });

  it("puts every command of one run in the run's group, so one undo takes the turn back (EDT1)", async () => {
    const { store, applied, dispatcher } = setup();
    const runId = newId<'AgentRun'>();
    unwrap(await dispatcher.dispatch('clips.rename', { id: 'c1', title: 'A' }, meta({ runId })));
    unwrap(await dispatcher.dispatch('clips.rename', { id: 'c2', title: 'B' }, meta({ runId })));
    unwrap(await dispatcher.dispatch('clips.rename', { id: 'c3', title: 'C' }, meta()));
    expect(store.entries().map((entry) => entry.group ?? null)).toEqual([
      agentTurnGroup(runId),
      agentTurnGroup(runId),
      null,
    ]);
    const mcp = { ...meta({ runId }), source: 'mcp' as const, actor: 'mcp:session' };
    unwrap(await dispatcher.dispatch('clips.rename', { id: 'c4', title: 'D' }, mcp));
    expect(store.entries().at(-1)?.group ?? null).toBeNull();
    expect(applied).toEqual(['A', 'B', 'C', 'D']);
  });
});
