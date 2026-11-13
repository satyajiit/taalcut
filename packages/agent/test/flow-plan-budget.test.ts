// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { budgetBreach } from '../src/budget';
import { applyEvent, initialState } from '../src/state';
import { FLOW_BUDGET } from '../src/state-flow';

function startedRun(projectId?: string) {
  const state = initialState(newId<'AgentRun'>());
  applyEvent(state, {
    runId: state.runId,
    type: 'run.started',
    v: 1,
    seq: 1,
    at: 0,
    payload: {
      conversationId: 'c',
      ...(projectId ? { projectId } : {}),
      message: 'Inspect my clips',
      autonomy: 'autopilot',
      budget: { maxTokens: 200_000, maxWallClockMs: 15 * 60_000, maxUsd: 0.5 },
      localOnly: false,
      soulVersion: '1',
      catalogueHash: 'test',
    },
  });
  return state;
}

describe('money limits for flow skills planned outside a flow', () => {
  for (const projectId of [undefined, 'existing-project']) {
    it.each(['plan.created', 'plan.updated'] as const)(
      `%s retains the spending stop ${projectId ? 'with a project id' : 'without a project'}`,
      (type) => {
        const state = startedRun(projectId);
        applyEvent(state, {
          runId: state.runId,
          type,
          v: 1,
          seq: 2,
          at: 0,
          payload: { steps: [{ id: 's1', text: 'Inspect clips', skill: 'timeline.librarian' }] },
        });

        expect(state.budget).toEqual({ ...FLOW_BUDGET, maxUsd: 0.5 });
        expect(budgetBreach(state, { usd: 0.51 }, 0)).toEqual({ limit: 'usd', used: 0, max: 0.5 });
      },
    );
  }

  it('retains an approved spending increase when the plan changes', () => {
    const state = startedRun();
    applyEvent(state, {
      runId: state.runId,
      type: 'budget.raised',
      v: 1,
      seq: 2,
      at: 0,
      payload: { budget: { maxUsd: 2 } },
    });
    applyEvent(state, {
      runId: state.runId,
      type: 'plan.updated',
      v: 1,
      seq: 3,
      at: 0,
      payload: { steps: [{ id: 's1', text: 'Inspect clips', skill: 'timeline.librarian' }] },
    });

    expect(budgetBreach(state, { usd: 1 }, 0)).toBeUndefined();
    expect(budgetBreach(state, { usd: 2.01 }, 0)).toEqual({ limit: 'usd', used: 0, max: 2 });
  });
});
