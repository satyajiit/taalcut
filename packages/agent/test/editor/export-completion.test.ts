// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { newId, ok, unwrap } from '@taalcut/core';
import { exportHandoffProblem } from '../../src/editor/export-completion';
import { editorBrief } from '../../src/editor/editor-brief';
import { initialState, type StepState } from '../../src/run-state';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

describe('export completion evidence', () => {
  function scenario() {
    const state = initialState(newId<'AgentRun'>());
    const projectId = newId<'Project'>();
    const output = { timelineId: newId<'Timeline'>(), revision: 37 };
    const step: StepState = {
      id: 's1',
      text: 'Export',
      skill: 'timeline.editor',
      status: 'doing',
      turns: 1,
      verifyRetries: 0,
      ended: false,
      summary: '',
      input: { projectId, timelineId: output.timelineId, request: 'export the 4k60 version hevc' },
    };
    state.stepIndex = 0;
    state.plan = [step];
    state.transcript.push({
      kind: 'assistant',
      step: 0,
      modelCallId: 'm1',
      message: {} as never,
      toolCallIds: [],
    });
    return { state, step, output, projectId };
  }

  it('rejects empty and unsupported success claims without an export', async () => {
    const s = scenario();
    expect(await exportHandoffProblem(s.state, s.step, s.output)).toContain('No completed export');
    s.state.lastTurn = { phase: 'act', hadToolCalls: true, text: 'Done. Your video is exported.' };
    expect(await exportHandoffProblem(s.state, s.step, s.output)).toContain('No completed export');
  });

  it('requires a non-export explanation to be visible to the person', async () => {
    const s = scenario();
    const reason = 'The requested encoder is unavailable, so no video was exported.';
    expect(
      await exportHandoffProblem(s.state, s.step, { ...s.output, notExportedReason: reason }),
    ).toBeDefined();
    s.state.lastTurn = { phase: 'act', hadToolCalls: true, text: reason };
    expect(
      await exportHandoffProblem(s.state, s.step, { ...s.output, notExportedReason: reason }),
    ).toBeUndefined();
  });

  it('allows export questions but still checks an explicit action routed as an answer', async () => {
    const s = scenario();
    const world = editorWorld();
    s.state.started = {
      conversationId: 'c',
      message: 'Which export settings are available?',
      autonomy: 'autopilot',
      budget: s.state.budget,
      localOnly: false,
      soulVersion: 'test',
      catalogueHash: 'test',
      editor: {
        ...editorBrief('Which export settings are available?', contextOf(world), world.v.timeline),
        route: 'answer',
      },
    };
    const input = {
      projectId: s.projectId,
      timelineId: s.output.timelineId,
      request: s.state.started.message,
    };
    expect(await exportHandoffProblem(s.state, { ...s.step, input }, s.output)).toBeUndefined();
    const exportInput = {
      projectId: s.projectId,
      timelineId: s.output.timelineId,
      request: 'please export the 4k60 version hevc',
    };
    expect(await exportHandoffProblem(s.state, { ...s.step, input: exportInput }, s.output)).toContain(
      'No completed export',
    );
  });

  it('accepts only a ready export in this run for the same project, timeline and revision', async () => {
    const s = scenario();
    const id = newId<'ToolRun'>();
    s.state.toolCallOrder.push(id);
    const requested = {
      toolCallId: id,
      modelCallId: 'm1',
      modelToolCallId: 'call',
      tool: 'render.export',
      callName: 'render_export',
      meta: false,
      sideEffect: 'external' as const,
      input: { projectId: s.projectId, timelineId: s.output.timelineId, timelineRevision: 37 },
    };
    const completed = {
      kind: 'completed' as const,
      at: 1,
      payload: {
        toolCallId: id,
        output: {
          kind: 'inline' as const,
          value: {
            render: {
              id: newId<'Render'>(),
              status: 'ready',
              projectId: s.projectId,
              timelineId: s.output.timelineId,
              timelineRevision: 37,
            },
          },
        },
        cached: false,
        deduplicated: false,
        attempts: 1,
        durationMs: 1,
        usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
      },
    };
    s.state.toolCalls[id] = { requested, requestedAt: 0 };
    expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    s.state.toolCalls[id]!.outcome = completed;
    expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeUndefined();
    expect(
      await exportHandoffProblem(s.state, s.step, { ...s.output, timelineId: newId<'Timeline'>() }),
    ).toContain('timeline in this editing request');
    for (const input of [
      { ...requested.input, projectId: newId<'Project'>() },
      { ...requested.input, timelineId: newId<'Timeline'>() },
      { ...requested.input, timelineRevision: 36 },
    ]) {
      s.state.toolCalls[id] = { requested: { ...requested, input }, requestedAt: 0, outcome: completed };
      expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    }
    s.state.toolCalls[id] = {
      requested: { ...requested, modelCallId: 'earlier-step' },
      requestedAt: 0,
      outcome: completed,
    };
    expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeUndefined();
    const saved = s.state.toolCalls[id]!;
    const ref = {
      id: newId<'Artifact'>(),
      mediaType: 'application/json',
      bytes: 10_000,
      summary: 'Export result',
    };
    s.state.toolCalls[id] = {
      ...saved,
      outcome: { ...completed, payload: { ...completed.payload, output: { kind: 'artifact', ref } } },
    };
    const get = async () =>
      ok({ ref, data: new TextEncoder().encode(JSON.stringify(completed.payload.output.value)) });
    expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    expect(await exportHandoffProblem(s.state, s.step, s.output, { get })).toBeUndefined();
    expect(
      await exportHandoffProblem(s.state, s.step, s.output, {
        get: async () => ok({ ref, data: new TextEncoder().encode('invalid') }),
      }),
    ).toBeDefined();
    s.state.toolCalls[id] = saved;
    for (const status of ['queued', 'rendering', 'needsAttention', 'failed', 'cancelled']) {
      completed.payload.output.value.render.status = status;
      expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    }
    completed.payload.output.value.render.status = 'ready';
    completed.payload.output.value.render.timelineRevision = 36;
    expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeDefined();
  });

  it('sends a silent read-only handoff back and completes with the visible limitation', async () => {
    const world = editorWorld();
    const { timeline } = world.v;
    const reason = 'This test has no export tool available, so no video was exported.';
    const h = editorHarness(
      world,
      turns(
        { toolCalls: [call('timeline_get', { timelineId: timeline.id })] },
        { toolCalls: [call('handOff', { timelineId: timeline.id, revision: timeline.revision })] },
        {
          text: reason,
          toolCalls: [
            call('handOff', {
              timelineId: timeline.id,
              revision: timeline.revision,
              notExportedReason: reason,
            }),
          ],
        },
      ),
    );
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        message: 'export the 4k60 version hevc',
        editorContext: contextOf(world),
      }),
    );
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome.status).toBe('completed');
    expect(outcome.report).toBe(reason);
    const events = await h.events(runId);
    expect(
      ofType(events, 'tool.failed').some((event) =>
        event.payload.error.detail?.includes('No completed export'),
      ),
    ).toBe(true);
    expect(ofType(events, 'run.completed')).toHaveLength(1);
  });
});
