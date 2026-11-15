// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: a post caption asked for in the chat's own words. It is delivered by timeline.setPostCaption (the same
 * tool, so the same rule holds) and its saved text is shown in the answer. That the words ask for post copy and
 * not for subtitles is still read by `asksForPostCaption`.
 */
import { expect, it } from 'vitest';
import { newId, unwrap } from '@taalcut/core';
import { asksForPostCaption, postCaptionHandoffProblem } from '../../src/editor/post-caption-completion';
import { initialState, type StepState, type ToolCallState } from '../../src/run-state';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

const CAPTION =
  'That airport feeling.\n\nCreated with @taalcut.app\n\n#airport\n\n(airport walk, gate, travel day)';
const PARTS = {
  platform: 'instagram',
  body: 'That airport feeling.',
  hashtags: ['airport'],
  keywords: ['airport walk', 'gate', 'travel day'],
};

/** An Editor step asked in the chat's words, with the calls the run has made so far. */
function scenario(request: string) {
  const state = initialState(newId<'AgentRun'>());
  const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
  const step: StepState = {
    id: 's1',
    text: 'Caption',
    skill: 'timeline.editor',
    status: 'doing',
    turns: 1,
    verifyRetries: 0,
    ended: false,
    summary: '',
    input: { ...target, request },
  };
  /** A completed timeline.setPostCaption, as the tool answers it. */
  const save = (text = CAPTION, on = target, done = true) => {
    const id = newId<'ToolRun'>();
    const requested: ToolCallState['requested'] = {
      toolCallId: id,
      modelCallId: 'm1',
      modelToolCallId: `call-${state.toolCallOrder.length}`,
      tool: 'timeline.setPostCaption',
      callName: 'timeline_setPostCaption',
      meta: false,
      sideEffect: 'write',
      input: { ...on, ...PARTS },
    };
    const payload = {
      toolCallId: id,
      output: {
        kind: 'inline' as const,
        value: { timelineId: on.timelineId, revision: 2, platform: 'instagram', text },
      },
      cached: false,
      deduplicated: false,
      attempts: 1,
      durationMs: 1,
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
    };
    state.toolCallOrder.push(id);
    state.toolCalls[id] = {
      requestedAt: 0,
      requested,
      ...(done ? { outcome: { kind: 'completed' as const, at: 1, payload } } : {}),
    };
  };
  const says = (text: string) => {
    state.lastTurn = { phase: 'act', hadToolCalls: true, text };
  };
  const problem = (handoff: unknown = {}, of: StepState = step) =>
    postCaptionHandoffProblem(state, of, handoff);
  return { state, step, target, save, says, problem };
}

it('reads post copy out of the chat’s words, without catching subtitle edits', () => {
  for (const request of [
    'write an Instagram caption',
    'create a caption for my Instagram post',
    'actually i mean to have ig captions for the post. not subtitles',
    'Disable subtitles and write an Instagram caption',
  ])
    expect(asksForPostCaption(request)).toBe(true);
  for (const request of [
    'Make the subtitles larger',
    'Turn off captions for my reel',
    'Make captions for my reel larger',
    'Is this Instagram caption too long?',
    'I want to disable Instagram captions',
  ])
    expect(asksForPostCaption(request)).toBe(false);
});

it('owes a caption saved through the tool and shown in the answer, when the words ask for one', async () => {
  const s = scenario('write an Instagram caption');
  const unsaved = await s.problem();
  expect(unsaved).toContain('The person asked for a social post caption, not subtitles.');
  expect(unsaved).toContain('Save its parts with timeline.setPostCaption');
  expect(unsaved).toContain('handOff.notSavedPostCaptionReason');
  // Words alone, however good, are not the caption: nothing held them to the rule or saved them.
  s.says(CAPTION);
  expect(await s.problem()).toContain('Save its parts with timeline.setPostCaption');
  // A save that did not finish, or on another video, is not it either.
  s.save(CAPTION, s.target, false);
  s.save(CAPTION, { ...s.target, timelineId: newId<'Timeline'>() });
  expect(await s.problem()).toContain('Save its parts with timeline.setPostCaption');

  s.save();
  s.says('Saved.');
  expect(await s.problem()).toBe(
    'The caption is saved, but the person reads it in this chat: put the text timeline.setPostCaption ' +
      'answered in your visible response, exactly as written, then hand off again.',
  );
  s.says(`Here is your caption:\n\n${CAPTION}\n\nIt is saved with the video.`);
  expect(await s.problem()).toBeUndefined();
});

it('holds a run that saved a caption to showing it, whatever language asked for it', async () => {
  // No English pattern finds this request; the model stated the ask by calling the tool.
  const s = scenario('escribe el texto para publicar en instagram');
  expect(await s.problem()).toBeUndefined();
  s.save();
  expect(await s.problem()).toContain('put the text timeline.setPostCaption answered');
  // The text shown is the one saved last.
  s.save('A second caption\n\n#airport\n\n(a, b, c)');
  s.says(CAPTION);
  expect(await s.problem()).toContain('put the text timeline.setPostCaption answered');
  s.says('A second caption #airport (a, b, c)');
  expect(await s.problem()).toBeUndefined();
});

it('leaves subtitle requests and other skills alone, and takes a visible reason for no caption', async () => {
  expect(await scenario('Make the subtitles larger').problem()).toBeUndefined();
  const s = scenario('write an Instagram caption');
  expect(await s.problem({}, { ...s.step, skill: 'timeline.maker' })).toBeUndefined();
  const reason = 'The video has no clips yet, so there is nothing to write a caption from.';
  const output = { notSavedPostCaptionReason: reason };
  expect(await s.problem(output)).toContain('Save its parts with timeline.setPostCaption');
  s.says(reason);
  expect(await s.problem(output)).toBeUndefined();
});

it('retries the silent clarification handoff, saves the caption with the tool and never touches subtitles', async () => {
  const world = editorWorld();
  const timeline = world.v.timeline;
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const output = { timelineId: timeline.id, revision: timeline.revision };
  const saved = { timelineId: timeline.id, revision: timeline.revision + 1 };
  const h = editorHarness(
    world,
    turns(
      { toolCalls: [call('timeline_get', { timelineId: timeline.id })] },
      { toolCalls: [call('handOff', output)] },
      { toolCalls: [call('timeline_setPostCaption', { ...target, ...PARTS })] },
      { text: 'Your caption is saved.', toolCalls: [call('handOff', saved)] },
      { text: `Here it is:\n\n${CAPTION}`, toolCalls: [call('handOff', saved)] },
    ),
  );
  const runId = unwrap(
    await h.agent.start({
      conversationId: 'c',
      message: 'actually i mean to have ig captions for the post. not subtitles',
      editorContext: contextOf(world),
    }),
  );
  const result = unwrap(await h.agent.wait(runId));
  expect(result.status).toBe('completed');
  expect(result.report).toBe(`Here it is:\n\n${CAPTION}`);
  expect(world.timelines.get(timeline.id)?.postCaptions).toEqual([
    { platform: 'instagram', text: CAPTION, writtenBy: 'ai' },
  ]);
  const events = await h.events(runId);
  const refusals = ofType(events, 'tool.failed').map((event) => event.payload.error.detail ?? '');
  expect(refusals.some((detail) => detail.includes('Save its parts with timeline.setPostCaption'))).toBe(
    true,
  );
  expect(refusals.some((detail) => detail.includes('put the text timeline.setPostCaption answered'))).toBe(
    true,
  );
  expect(ofType(events, 'tool.requested').some((event) => event.payload.tool.startsWith('captions.'))).toBe(
    false,
  );
});
