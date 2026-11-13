// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { agentTurnGroup, newId, unwrap } from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';

it('AI history traverses the same grouped queue and a repeated precondition cannot undo another step', async () => {
  const { bus, projectId, projects } = setupBus();
  await bus.dispatch('project.rename', { projectId, name: 'Before AI' }, UI);
  const runId = newId<'AgentRun'>();
  const actor = { source: 'agent', actor: `agent:${runId}` } as const;
  const group = agentTurnGroup(runId);
  unwrap(await bus.editing.acquire(projectId, runId));
  await bus.dispatch('project.rename', { projectId, name: 'First' }, actor, { group });
  await bus.dispatch('project.rename', { projectId, name: 'Second' }, actor, { group });
  const state = unwrap(await bus.history(projectId, { includeIds: true }));
  const input = { projectId, expectedCommandId: state.undoId!, expectedHistoryToken: state.token! };
  expect((await bus.dispatch('history.undo', input, UI)).ok).toBe(false);
  expect((await bus.dispatch('history.undo', input, actor)).ok).toBe(true);
  expect(projects.nameOf(projectId)).toBe('Before AI');
  expect((await bus.dispatch('history.undo', input, actor)).ok).toBe(false);
  expect(projects.nameOf(projectId)).toBe('Before AI');
  const redo = unwrap(await bus.history(projectId, { includeIds: true }));
  expect(
    (
      await bus.dispatch(
        'history.redo',
        { projectId, expectedCommandId: redo.redoId!, expectedHistoryToken: redo.token! },
        actor,
      )
    ).ok,
  ).toBe(true);
  expect(projects.nameOf(projectId)).toBe('Second');
  expect(
    (await bus.dispatch('history.undo', input, actor, { idempotencyKey: 'repeat-old-request' })).ok,
  ).toBe(false);
  const next = unwrap(await bus.history(projectId, { includeIds: true }));
  expect(next.token).not.toBe(state.token);
  expect(
    (
      await bus.dispatch(
        'history.undo',
        { projectId, expectedCommandId: next.undoId!, expectedHistoryToken: next.token! },
        actor,
      )
    ).ok,
  ).toBe(true);
  expect(projects.nameOf(projectId)).toBe('Before AI');
  bus.editing.stop(runId);
  const stopped = await bus.dispatch('history.undo', input, actor);
  expect(stopped.ok).toBe(false);
  expect(projects.nameOf(projectId)).toBe('Before AI');
});

describe('native history admission', () => {
  it('validates the complete payload before entering the queue', async () => {
    const { bus, projectId } = setupBus();
    expect((await bus.dispatch('history.undo', { projectId }, UI)).ok).toBe(false);
    expect((await bus.dispatch('history.redo', { projectId, expectedCommandId: 'invalid' }, UI)).ok).toBe(
      false,
    );
  });
});
