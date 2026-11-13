// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { newId, ok, unwrap } from '@taalcut/core';
import { coverHandoffProblem } from '../../src/editor/cover-completion';
import { exportHandoffProblem } from '../../src/editor/export-completion';
import { initialState, type StepState, type ToolCallState } from '../../src/run-state';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

function scenario(request = 'make a /hallmark thumbnail for the airport reel') {
  const state = initialState(newId<'AgentRun'>());
  const projectId = newId<'Project'>();
  const output = { timelineId: newId<'Timeline'>(), revision: 43 };
  const step: StepState = {
    id: 'cover',
    text: 'Cover',
    skill: 'timeline.editor',
    status: 'doing',
    turns: 1,
    verifyRetries: 0,
    ended: false,
    summary: '',
    input: { projectId, timelineId: output.timelineId, request },
  };
  const id = newId<'ToolRun'>();
  const receipt = { fileName: 'airport-cover.jpg', width: 1080, height: 1920, revision: 43 };
  const tool: ToolCallState = {
    requestedAt: 0,
    requested: {
      toolCallId: id,
      modelCallId: 'm1',
      modelToolCallId: 'call',
      tool: 'render.exportCover',
      callName: 'render_exportCover',
      meta: false,
      sideEffect: 'write',
      input: { projectId, timelineId: output.timelineId, revision: 43 },
    },
    outcome: {
      kind: 'completed',
      at: 1,
      payload: {
        toolCallId: id,
        output: { kind: 'inline', value: receipt },
        cached: false,
        deduplicated: false,
        attempts: 1,
        durationMs: 1,
        usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
      },
    },
  };
  return { state, step, output, id, tool, receipt, projectId };
}

describe('cover completion evidence', () => {
  it('requires a saved image for create, save and compound video/cover requests', async () => {
    for (const request of [
      'make a thumbnail',
      'create a /hallmark cover',
      'I need a cover',
      'save the thumbnail',
      'export the video and make a thumbnail',
      'Please export the cover',
      'can you generate a thumbnail?',
    ]) {
      const s = scenario(request);
      expect(await coverHandoffProblem(s.state, s.step, s.output)).toContain('No saved JPEG cover');
    }
    for (const request of [
      'Why did the thumbnail fail?',
      'How do I make a thumbnail?',
      'Which cover is better?',
      'Explain how to export the cover',
      'Can you explain how to make a cover?',
      'Which settings do I need to export the video and cover?',
      'Export the video without a cover',
      'Do not make a thumbnail',
      'make the subtitles larger',
    ]) {
      const s = scenario(request);
      expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeUndefined();
    }
  });

  it('does not demand a video export for cover-only delivery, but checks both in compound requests', async () => {
    for (const request of [
      'export the cover',
      'render a 4k thumbnail for my video',
      'save a cover as JPEG',
      'make a thumbnail and export it',
      'save the cover and download it',
      'export the video cover',
      "export the video's thumbnail",
    ]) {
      const s = scenario(request);
      expect(await exportHandoffProblem(s.state, s.step, s.output)).toBeUndefined();
      expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    }
    for (const request of [
      'export the video and cover',
      'save a cover then export the reel',
      'export the cover and video',
      'export at 4k60fps and make a cover',
      'export it and create a thumbnail',
      'make a thumbnail and export at 60fps',
      'create a cover then export as HEVC',
    ]) {
      const s = scenario(request);
      expect(await coverHandoffProblem(s.state, s.step, s.output)).toContain('No saved JPEG cover');
      expect(await exportHandoffProblem(s.state, s.step, s.output)).toContain('No completed export');
      s.state.toolCallOrder.push(s.id);
      s.state.toolCalls[s.id] = s.tool;
      expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeUndefined();
      expect(await exportHandoffProblem(s.state, s.step, s.output)).toContain('No completed export');
    }
  });

  it('requires a completed JPEG receipt for the same project, timeline and final revision', async () => {
    const s = scenario();
    s.state.toolCallOrder.push(s.id);
    s.state.toolCalls[s.id] = s.tool;
    expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeUndefined();
    expect(
      await coverHandoffProblem(s.state, s.step, { ...s.output, timelineId: newId<'Timeline'>() }),
    ).toContain('timeline in this editing request');
    expect(await coverHandoffProblem(s.state, s.step, { ...s.output, revision: 44 })).toBeDefined();
    for (const input of [
      { projectId: newId<'Project'>(), timelineId: s.output.timelineId, revision: 43 },
      { projectId: s.projectId, timelineId: newId<'Timeline'>(), revision: 43 },
    ]) {
      s.state.toolCalls[s.id] = { ...s.tool, requested: { ...s.tool.requested, input } };
      expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    }
    s.state.toolCalls[s.id] = { ...s.tool, outcome: undefined };
    expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    s.state.toolCalls[s.id] = s.tool;
    for (const fileName of ['draft.png', '../airport.jpg']) {
      s.receipt.fileName = fileName;
      expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    }
    s.receipt.fileName = 'airport.jpg';
    s.receipt.revision = 42;
    expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    s.receipt.revision = 43;
    s.receipt.width = 0;
    expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeDefined();
  });

  it('reads bounded recorded artifacts and rejects missing, mismatched or malformed receipts', async () => {
    const s = scenario();
    const ref = { id: newId<'Artifact'>(), mediaType: 'application/json', bytes: 100, summary: 'Cover' };
    const done = s.tool.outcome!;
    if (done.kind !== 'completed') throw new Error('Expected completed fixture');
    s.state.toolCallOrder.push(s.id);
    s.state.toolCalls[s.id] = {
      ...s.tool,
      outcome: { ...done, payload: { ...done.payload, output: { kind: 'artifact', ref } } },
    };
    expect(await coverHandoffProblem(s.state, s.step, s.output)).toBeDefined();
    const data = new TextEncoder().encode(JSON.stringify(s.receipt));
    expect(
      await coverHandoffProblem(s.state, s.step, s.output, { get: async () => ok({ ref, data }) }),
    ).toBeUndefined();
    for (const stored of [
      { ref: { ...ref, id: newId<'Artifact'>() }, data },
      { ref: { ...ref, mediaType: 'text/plain' }, data },
      { ref, data: new TextEncoder().encode('bad json') },
      { ref, data: new Uint8Array(2 * 1024 * 1024 + 1) },
    ])
      expect(
        await coverHandoffProblem(s.state, s.step, s.output, { get: async () => ok(stored) }),
      ).toBeDefined();
  });

  it('accepts a limitation only when it is also visible to the person', async () => {
    const s = scenario('generate a new AI thumbnail');
    const reason = 'Image generation is unavailable; no new AI thumbnail was made.';
    const output = { ...s.output, notSavedCoverReason: reason };
    expect(await coverHandoffProblem(s.state, s.step, output)).toBeDefined();
    s.state.lastTurn = { phase: 'act', hadToolCalls: true, text: reason };
    expect(await coverHandoffProblem(s.state, s.step, output)).toBeUndefined();
  });

  it('rejects a silent agent handoff and delivers its visible limitation', async () => {
    const world = editorWorld();
    const timeline = world.v.timeline;
    const output = { timelineId: timeline.id, revision: timeline.revision };
    const reason = 'This test has no cover export tool, so no thumbnail was saved.';
    const limitation = {
      text: reason,
      toolCalls: [call('handOff', { ...output, notSavedCoverReason: reason })],
    };
    const h = editorHarness(
      world,
      turns(
        { toolCalls: [call('timeline_get', { timelineId: timeline.id })] },
        { toolCalls: [call('handOff', output)] },
        limitation,
        limitation,
      ),
    );
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        message: 'make a thumbnail for this reel',
        editorContext: contextOf(world),
      }),
    );
    const result = unwrap(await h.agent.wait(runId));
    expect(result).toMatchObject({ status: 'completed' });
    expect(result.report).toBe(reason);
    expect(
      ofType(await h.events(runId), 'tool.failed').some((event) =>
        event.payload.error.detail?.includes('No saved JPEG cover'),
      ),
    ).toBe(true);
  });
});
