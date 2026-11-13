// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  agentTurnGroup,
  CommandBusToken,
  createContainer,
  newId,
  ok,
  ProjectBudgetStoreToken,
  type CommandBus,
} from '@taalcut/core';
import type { ModelClient } from '@taalcut/models';
import type { LibraryPorts } from '@taalcut/library';
import type { DesignJob, templateDesigner } from '@taalcut/render';
import { describe, expect, it, vi } from 'vitest';
import { LibraryPortsToken, ModelClientToken } from '../src/shared/tokens';
import { templateDesignerOf } from '../src/utility/roots/agent-designer';

type DesignerDeps = Parameters<typeof templateDesigner>[0];
vi.mock('@taalcut/render', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  templateDesigner: (deps: DesignerDeps) => async () => {
    const request = { system: 'Design the supplied overlay.', messages: [], tools: [], maxTokens: 100 };
    const first = await deps.model.turn(request);
    if (!first.ok) return first;
    const write = await deps.dispatch('workspace.write', { path: 'overlay.html' });
    if (!write.ok) return write;
    const second = await deps.model.turn(request);
    return second.ok ? { ok: true, value: { reason: 'Finished' } } : second;
  },
}));
vi.mock('../src/utility/roots/agent-workspace-tools', () => ({
  canDesign: () => true,
  workspaceToolDepsOf: () => ({}),
}));
vi.mock('../src/utility/roots/model-windows', () => ({ moduleSeesImages: () => () => false }));

describe('designer project accounting', () => {
  it('traces calls and groups workspace commands in the run, checking the cap again before a second call', async () => {
    const projectId = newId<'Project'>();
    const runId = newId<'AgentRun'>();
    const complete = vi.fn(async () =>
      ok({ text: 'Done', toolCalls: [], provider: 'recorded', model: 'design', local: false }),
    );
    const dispatch = vi.fn(async () => ok({ result: undefined }));
    let checks = 0;
    const container = createContainer()
      .value(ModelClientToken, { complete } as unknown as ModelClient)
      .value(LibraryPortsToken, { artifacts: { put: vi.fn(), get: vi.fn() } } as unknown as LibraryPorts)
      .value(CommandBusToken, { dispatch } as unknown as CommandBus)
      .value(ProjectBudgetStoreToken, {
        get: async () =>
          ok({
            projectId,
            cap: { currency: 'USD', micros: 100 },
            spent: { currency: 'USD', micros: checks++ === 0 ? 0 : 100 },
          }),
        setCap: vi.fn(),
      });
    const designer = templateDesignerOf(container, { projectId, runId });
    const answer = await designer!({ projectId } as DesignJob);
    expect(answer.ok).toBe(false);
    expect(complete).toHaveBeenCalledOnce();
    expect((complete.mock.calls[0] as unknown[])[0]).toMatchObject({ trace: { projectId, runId } });
    expect(dispatch).toHaveBeenCalledWith(
      'workspace.write',
      { path: 'overlay.html' },
      { source: 'agent', actor: `agent:${runId}` },
      { group: agentTurnGroup(runId) },
    );
    expect(checks).toBe(2);
  });
});
