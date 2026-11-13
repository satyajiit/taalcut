// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CancelledError, newId, ok, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { editsHandoffProblem } from '../../src/editor/edits-completion';
import { EDITOR_TURN_FAMILIES } from '../../src/editor/editor-route';
import { initialState, type StepState, type ToolCallState } from '../../src/run-state';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

function scenario(request = 'export now at 4k60fps and then put on edits') {
  const state = initialState(newId<'AgentRun'>());
  const projectId = newId<'Project'>();
  const output = { timelineId: newId<'Timeline'>(), revision: 42 };
  const renderId = newId<'Render'>();
  const step: StepState = {
    id: 's1',
    text: 'Export and stage',
    skill: 'timeline.editor',
    status: 'doing',
    turns: 1,
    verifyRetries: 0,
    ended: false,
    summary: '',
    input: { projectId, timelineId: output.timelineId, request },
  };
  function add(tool: string, input: unknown, value: unknown): ToolCallState {
    const id = newId<'ToolRun'>();
    const call: ToolCallState = {
      requestedAt: 0,
      requested: {
        toolCallId: id,
        modelCallId: 'm1',
        modelToolCallId: id,
        tool,
        callName: tool.replace('.', '_'),
        meta: false,
        sideEffect: 'external',
        input,
      },
      outcome: {
        kind: 'completed',
        at: 1,
        payload: {
          toolCallId: id,
          output: { kind: 'inline', value },
          cached: false,
          deduplicated: false,
          attempts: 1,
          durationMs: 1,
          usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
        },
      },
    };
    state.toolCallOrder.push(id);
    state.toolCalls[id] = call;
    return call;
  }
  const render = {
    id: renderId,
    status: 'ready',
    projectId,
    timelineId: output.timelineId,
    timelineRevision: output.revision,
  };
  const exported = add(
    'render.export',
    { projectId, timelineId: output.timelineId, timelineRevision: output.revision },
    { render },
  );
  const staging = { pluginId: 'instagram-edits', toolName: 'api.stageReel', input: { renderId } };
  return {
    state,
    step,
    output,
    renderId,
    projectId,
    render,
    exported,
    staging,
    add,
    check: () => editsHandoffProblem(state, step, output),
  };
}

describe('Instagram Edits completion evidence', () => {
  it('does not treat a ready export or capability lookup as completing the exact reported compound request', async () => {
    const s = scenario();
    s.add('plugins.listTools', { pluginId: 'instagram-edits' }, [{ name: 'api.stageReel' }]);
    expect(await s.check()).toContain('has not been staged');
    expect(EDITOR_TURN_FAMILIES).toContain('plugins');
  });

  it.each([
    'export the finished video and send it to Instagram Edits',
    'can you export this reel and import it into edits?',
    'please render this video then stage it in Edits',
    'export the video and add it to Edits',
    'export and open in Edits',
  ])('requires a staging receipt for %s', async (request) => {
    expect(await scenario(request).check()).toContain('has not been staged');
  });

  it.each([
    'How do I send a video to Edits?',
    'Can you explain how to put it in Edits?',
    'export the video but do not send it to Edits',
    'export the video but do not open in Edits',
    'export the video, skip import into Edits',
    'apply these edits and export the reel',
    'import a project from Edits',
    'put the existing video in Edits',
    'send the existing export to Edits',
  ])('does not create a staging obligation for %s', async (request) => {
    expect(await scenario(request).check()).toBeUndefined();
  });

  it('requires the correct external plugin operation, matching render and affirmative recorded result', async () => {
    const attempts = [
      { tool: 'plugins.callRead', input: {} },
      { tool: 'plugins.callExternal', input: { pluginId: 'postiz' } },
      { tool: 'plugins.callExternal', input: { toolName: 'api.listProjects' } },
      { tool: 'plugins.callExternal', input: { input: { renderId: newId<'Render'>() } } },
      { tool: 'plugins.callExternal', input: {}, result: { staged: false } },
      { tool: 'plugins.callExternal', input: {}, result: { staged: 'true' } },
      { tool: 'plugins.callExternal', input: {}, result: { message: 'Done' } },
    ];
    for (const attempt of attempts) {
      const s = scenario();
      s.add(attempt.tool, { ...s.staging, ...attempt.input }, attempt.result ?? { staged: true });
      expect(await s.check()).toBeDefined();
    }
    const s = scenario();
    const stage = s.add('plugins.callExternal', s.staging, { staged: true });
    expect(await s.check()).toBeUndefined();
    stage.outcome = {
      kind: 'failed',
      at: 2,
      payload: {
        toolCallId: stage.requested.toolCallId,
        error: CancelledError(),
        attempts: 1,
        durationMs: 1,
        usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
      },
    };
    expect(await s.check()).toBeDefined();
    stage.outcome = undefined;
    expect(await s.check()).toBeDefined();
  });

  it('does not accept a stage for another project, timeline or stale handoff revision', async () => {
    for (const changed of [
      { projectId: newId<'Project'>() },
      { timelineId: newId<'Timeline'>() },
      { timelineRevision: 41 },
      { status: 'failed' },
    ]) {
      const s = scenario();
      Object.assign(s.render, changed);
      s.add('plugins.callExternal', s.staging, { staged: true });
      expect(await s.check()).toBeDefined();
    }
  });

  it('reads an artifact-backed stage result only from this run’s completed receipt', async () => {
    const s = scenario();
    const stage = s.add('plugins.callExternal', s.staging, { staged: true });
    if (stage.outcome?.kind !== 'completed') throw new Error('Expected completed test receipt');
    const ref = {
      id: newId<'Artifact'>(),
      mediaType: 'application/json',
      bytes: 100,
      summary: 'Staged reel',
    };
    stage.outcome.payload.output = { kind: 'artifact', ref };
    expect(await s.check()).toBeDefined();
    const artifacts = {
      get: async () => ok({ ref, data: new TextEncoder().encode(JSON.stringify({ staged: true })) }),
    };
    expect(await editsHandoffProblem(s.state, s.step, s.output, artifacts)).toBeUndefined();
  });

  it('requires an unavailable/declined/failed staging explanation to be visible as well as structured', async () => {
    const s = scenario();
    const reason =
      'The video was exported, but Edits staging is unavailable because the plugin is disconnected.';
    const output = { ...s.output, notStagedReason: reason };
    expect(await editsHandoffProblem(s.state, s.step, output)).toBeDefined();
    s.state.lastTurn = { phase: 'act', text: reason, hadToolCalls: true };
    expect(await editsHandoffProblem(s.state, s.step, output)).toBeUndefined();
    expect(
      await editsHandoffProblem(s.state, s.step, { ...output, timelineId: newId<'Timeline'>() }),
    ).toBeDefined();
  });

  it('rejects a silent handoff in the real skill loop and reports the remaining Edits step', async () => {
    const world = editorWorld();
    const timeline = world.v.timeline;
    const exportReason = 'No export tool is available in this test.';
    const reason = 'The Edits plugin is unavailable here, so I could not put the video in Edits.';
    const h = editorHarness(
      world,
      turns(
        { toolCalls: [call('timeline_get', { timelineId: timeline.id })] },
        {
          text: exportReason,
          toolCalls: [
            call('handOff', {
              timelineId: timeline.id,
              revision: timeline.revision,
              notExportedReason: exportReason,
            }),
          ],
        },
        {
          text: `${exportReason} ${reason}`,
          toolCalls: [
            call('handOff', {
              timelineId: timeline.id,
              revision: timeline.revision,
              notExportedReason: exportReason,
              notStagedReason: reason,
            }),
          ],
        },
      ),
    );
    const id = unwrap(
      await h.agent.start({
        conversationId: 'c',
        message: 'export the finished video and put it into Edits',
        editorContext: contextOf(world),
      }),
    );
    const outcome = unwrap(await h.agent.wait(id));
    expect(outcome.report).toBe(`${exportReason} ${reason}`);
    const events = await h.events(id);
    expect(
      ofType(events, 'tool.failed').some((event) =>
        event.payload.error.detail?.includes('has not been staged'),
      ),
    ).toBe(true);
    expect(ofType(events, 'run.completed')).toHaveLength(1);
  });
});
