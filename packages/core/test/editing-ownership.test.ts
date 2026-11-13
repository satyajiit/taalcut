// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineCommand,
  idSchema,
  newId,
  ok,
  RationalTime,
  FrameRate,
} from '../src/index';

const user = { source: 'ui', actor: 'user' } as const;
const projectId = newId<'Project'>();
const runId = newId<'AgentRun'>();
const owner = { source: 'agent', actor: `agent:${runId}` } as const;
const payload = z.object({ projectId: idSchema<'Project'>(), value: z.number() });

function setup() {
  let value = 0;
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(0) });
  const write = defineCommand({
    name: 'edit.value',
    payload,
    sideEffect: 'write',
    handle: (input) => {
      const before = value;
      value = input.value;
      return ok({ result: value, inverse: { name: 'edit.value', payload: { ...input, value: before } } });
    },
  });
  bus.register(write);
  return { bus, value: () => value };
}

describe('project editing ownership in the command queue', () => {
  it('blocks other windows, shortcuts, MCP and another run, but permits reads and other projects', async () => {
    const { bus, value } = setup();
    await bus.editing.acquire(projectId, runId);
    for (const origin of [
      user,
      { source: 'shortcut', actor: 'user' },
      { source: 'mcp', actor: owner.actor },
      { source: 'agent', actor: 'agent:another' },
    ] as const) {
      expect(await bus.dispatch('edit.value', { projectId, value: 9 }, origin)).toMatchObject({
        ok: false,
        error: { code: 'core.project_editing' },
      });
    }
    expect(value()).toBe(0);
    bus.register(
      defineCommand({
        name: 'edit.read',
        payload,
        sideEffect: 'read',
        handle: () => ok({ result: value() }),
      }),
    );
    expect((await bus.dispatch('edit.read', { projectId, value: 0 }, user)).ok).toBe(true);
    expect((await bus.dispatch('edit.value', { projectId: newId<'Project'>(), value: 2 }, user)).ok).toBe(
      true,
    );
    expect((await bus.dispatch('edit.value', { projectId, value: 3 }, owner)).ok).toBe(true);
  });

  it('waits for executing writes before acquisition and rejects preexisting queued non-owner mutations', async () => {
    const { bus } = setup();
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    bus.register(
      defineCommand({
        name: 'edit.slow',
        payload,
        sideEffect: 'write',
        handle: async () => {
          started.resolve();
          await finish.promise;
          return ok({ result: 1 });
        },
      }),
    );
    const executing = bus.dispatch('edit.slow', { projectId, value: 1 }, user);
    await started.promise;
    const queued = bus.dispatch('edit.value', { projectId, value: 2 }, user);
    const acquired = vi.fn();
    const acquire = bus.editing.acquire(projectId, runId).then(acquired);
    await Promise.resolve();
    expect(acquired).not.toHaveBeenCalled();
    finish.resolve();
    await executing;
    expect(await queued).toMatchObject({ ok: false, error: { code: 'core.project_editing' } });
    await acquire;
    expect(acquired).toHaveBeenCalledWith({ ok: true, value: undefined });
  });

  it('Stop rejects queued and late owner writes, retains committed work and unlocks only after settlement', async () => {
    const { bus, value } = setup();
    await bus.editing.acquire(projectId, runId);
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    bus.register(
      defineCommand({
        name: 'edit.slow',
        payload,
        sideEffect: 'write',
        handle: async () => {
          started.resolve();
          await finish.promise;
          return ok({ result: 1 });
        },
      }),
    );
    await bus.dispatch('edit.value', { projectId, value: 7 }, owner);
    const executing = bus.dispatch('edit.slow', { projectId, value: 1 }, owner);
    await started.promise;
    const queued = bus.dispatch('edit.value', { projectId, value: 8 }, owner);
    bus.editing.stop(runId);
    const release = bus.editing.release(runId);
    expect(bus.editing.snapshot(projectId).phase).toBe('stopping');
    expect((await bus.dispatch('edit.value', { projectId, value: 9 }, user)).ok).toBe(false);
    finish.resolve();
    await executing;
    expect(await queued).toMatchObject({ ok: false, error: { code: 'core.editing_stopped' } });
    await release;
    expect(value()).toBe(7);
    expect(bus.editing.snapshot(projectId).phase).toBe('idle');
    expect((await bus.dispatch('edit.value', { projectId, value: 9 }, owner)).ok).toBe(false);
    expect((await bus.dispatch('edit.value', { projectId, value: 10 }, user)).ok).toBe(true);
  });

  it('allows owner history and refuses a cross-project batch before any writes', async () => {
    const { bus, value } = setup();
    await bus.editing.acquire(projectId, runId);
    await bus.dispatch('edit.value', { projectId, value: 4 }, owner, { group: 'turn' });
    expect((await bus.undo(projectId, user)).ok).toBe(false);
    expect((await bus.undo(projectId, owner)).ok).toBe(true);
    expect(value()).toBe(0);
    expect((await bus.redo(projectId, owner)).ok).toBe(true);
    const write = vi.fn(() => ok({ result: null }));
    bus.register(
      defineCommand({
        name: 'batch.edit',
        payload: z.object({ ids: z.array(idSchema<'Project'>()) }),
        project: () => null,
        affectedProjects: (input) => input.ids,
        sideEffect: 'write',
        handle: write,
      }),
    );
    expect((await bus.dispatch('batch.edit', { ids: [newId<'Project'>(), projectId] }, user)).ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('retains interrupted ownership until that run resumes or stops', async () => {
    const { bus } = setup();
    expect(bus.editing.restore(projectId, runId).ok).toBe(true);
    expect((await bus.dispatch('edit.value', { projectId, value: 1 }, owner)).ok).toBe(false);
    expect((await bus.editing.acquire(projectId, newId<'AgentRun'>())).ok).toBe(false);
    expect((await bus.editing.acquire(projectId, runId)).ok).toBe(true);
    expect((await bus.dispatch('edit.value', { projectId, value: 1 }, owner)).ok).toBe(true);
  });
  it('permits only server lifecycle cleanup while the ending run still owns the project', async () => {
    const { bus } = setup();
    const cleaned = vi.fn(() => ok({ result: null }));
    bus.register(
      defineCommand({ name: 'edit.cleanup', payload, sideEffect: 'write', lifecycle: true, handle: cleaned }),
    );
    await bus.editing.acquire(projectId, runId);
    expect((await bus.lifecycle('edit.cleanup', { projectId, value: 0 }, runId)).ok).toBe(false);
    bus.editing.stop(runId);
    expect((await bus.dispatch('edit.cleanup', { projectId, value: 0 }, owner)).ok).toBe(false);
    expect((await bus.lifecycle('edit.value', { projectId, value: 0 }, runId)).ok).toBe(false);
    expect((await bus.lifecycle('edit.cleanup', { projectId, value: 0 }, newId<'AgentRun'>())).ok).toBe(
      false,
    );
    expect((await bus.lifecycle('edit.cleanup', { projectId, value: 0 }, runId)).ok).toBe(true);
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(bus.editing.snapshot(projectId).phase).toBe('stopping');
  });

  it('finishes an admitted undo group before unlocking, while refusing subsequent operations', async () => {
    const { bus } = setup();
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const inverseCalls: number[] = [];
    bus.register(
      defineCommand({
        name: 'edit.group',
        payload,
        sideEffect: 'write',
        handle: async (input) => {
          if (input.value < 0) {
            inverseCalls.push(input.value);
            if (input.value === -2) {
              started.resolve();
              await finish.promise;
            }
          }
          return ok({
            result: null,
            inverse: { name: 'edit.group', payload: { ...input, value: -input.value } },
          });
        },
      }),
    );
    await bus.editing.acquire(projectId, runId);
    for (const value of [1, 2])
      await bus.dispatch('edit.group', { projectId, value }, owner, { group: 'turn' });
    const undo = bus.undo(projectId, owner);
    await started.promise;
    bus.editing.stop(runId);
    const release = bus.editing.release(runId);
    expect((await bus.undo(projectId, owner)).ok).toBe(false);
    expect(bus.editing.snapshot(projectId).phase).toBe('stopping');
    finish.resolve();
    expect((await undo).ok).toBe(true);
    await release;
    expect(inverseCalls).toEqual([-2, -1]);
    expect(bus.editing.snapshot(projectId).phase).toBe('idle');
  });
});

it('keeps the request context stable through Stop and recovery, and clears it when released', async () => {
  const { bus } = setup();
  const timelineId = newId<'Timeline'>();
  const context = {
    timelineId,
    revision: 4,
    playhead: RationalTime.of(12, FrameRate.of(30)),
    selection: [
      { kind: 'item' as const, timelineId, itemId: newId<'TimelineItem'>(), itemKind: 'clip' as const },
    ],
  };
  await bus.editing.acquire(projectId, runId, context);
  expect(bus.editing.snapshot(projectId).context).toEqual(context);
  bus.editing.stop(runId);
  expect(bus.editing.snapshot(projectId).context).toEqual(context);
  const recovered = setup().bus.editing;
  recovered.restore(projectId, runId, context);
  await recovered.acquire(projectId, runId);
  expect(recovered.snapshot(projectId).context).toEqual(context);
  await recovered.release(runId);
  expect(recovered.snapshot(projectId).context).toBeUndefined();
});

it('publishes durable affected IDs through unlock for a late document subscriber', async () => {
  const { bus } = setup();
  const id = newId<'TimelineItem'>();
  await bus.editing.acquire(projectId, runId);
  bus.editing.committed(owner, { affectedItemIds: [id] });
  await bus.editing.release(runId);
  expect(bus.editing.snapshot(projectId)).toMatchObject({ phase: 'idle', changedItemIds: [id] });
  await bus.editing.acquire(projectId, newId<'AgentRun'>());
  expect(bus.editing.snapshot(projectId).changedItemIds).toEqual([]);
});
