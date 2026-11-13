// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  availableEditorCapabilities,
  commandCapabilities,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineCommand,
  idSchema,
  newId,
  ok,
  unwrap,
} from '@taalcut/core';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { editorCatalogueTool } from '../src/editor-catalogue';
import { editorHistoryTools } from '../src/editor-history';
import { createToolRegistry } from '../src/registry';
import { toolContext } from './helpers/workspace-store';

it('reads capability availability afresh, including explicit person-only recording', async () => {
  let registered = false;
  const domains = [
    commandCapabilities(['timeline.freezeFrame']),
    [
      {
        id: 'narration.record',
        commands: [],
        tools: [],
        access: 'person' as const,
        reason: 'explicit_user_action',
      },
    ],
  ];
  const module = editorCatalogueTool(() => availableEditorCapabilities(domains, () => registered));
  expect(createToolRegistry([module]).ok).toBe(true);
  const tool = module.tools[0]!;
  const context = toolContext(async () => ok(null));
  expect(unwrap(await tool.run({}, context))).toMatchObject([
    { available: false },
    { available: true, access: 'person' },
  ]);
  registered = true;
  expect(unwrap(await tool.run({}, context))).toMatchObject([{ available: true }, { access: 'person' }]);
});

it('uses native guarded history for deliberate undo/redo cycles and refuses stale repeats or Stop', async () => {
  const bus = createCommandBus({ clock: createManualClock(0), store: createMemoryAuditLogStore() });
  const projectId = newId<'Project'>(),
    runId = newId<'AgentRun'>();
  const origin = { source: 'agent' as const, actor: `agent:${runId}` };
  let value = 0;
  bus.register(
    defineCommand({
      name: 'test.change',
      sideEffect: 'write',
      payload: z.object({ projectId: idSchema<'Project'>(), value: z.number() }),
      handle: async (input) => {
        const previous = value;
        value = input.value;
        return ok({
          result: value,
          inverse: { name: 'test.change', payload: { projectId, value: previous } },
        });
      },
    }),
  );
  unwrap(await bus.editing.acquire(projectId, runId));
  unwrap(await bus.dispatch('test.change', { projectId, value: 7 }, origin));
  const module = editorHistoryTools(bus);
  expect(createToolRegistry([module]).ok).toBe(true);
  const read = module.tools[0]!;
  const keys: string[] = [];
  let lastInput: unknown;
  for (const name of ['history.undo', 'history.redo', 'history.undo']) {
    const state = unwrap(
      await read.run(
        { projectId },
        toolContext(async () => ok(null)),
      ),
    ) as { token: string; undoId: string; redoId: string };
    const tool = module.tools.find((entry) => entry.name === name)!;
    const input = {
      projectId,
      expectedCommandId: name.endsWith('undo') ? state.undoId : state.redoId,
      expectedHistoryToken: state.token,
    };
    keys.push(tool.idempotencyKey!(input));
    const context = toolContext(async (payload) => {
      const done = await bus.dispatch(name, payload, origin);
      return done.ok ? ok(done.value.result) : done;
    });
    expect((await tool.run(input, context)).ok).toBe(true);
    expect(value).toBe(name.endsWith('undo') ? 0 : 7);
    expect((await tool.run(input, context)).ok).toBe(false);
    lastInput = input;
  }
  expect(new Set(keys).size).toBe(3);
  bus.editing.stop(runId);
  expect((await bus.dispatch('history.redo', lastInput, origin)).ok).toBe(false);
  await bus.editing.release(runId);
});
