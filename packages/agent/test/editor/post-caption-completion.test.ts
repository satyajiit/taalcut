// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { newId, unwrap } from '@taalcut/core';
import { postCaptionHandoffProblem } from '../../src/editor/post-caption-completion';
import { initialState, type StepState } from '../../src/run-state';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

it('requires visible post copy for explicit social captions, without catching subtitle edits', () => {
  const state = initialState(newId<'AgentRun'>());
  const step: StepState = {
    id: 's1',
    text: 'Caption',
    skill: 'timeline.editor',
    status: 'doing',
    turns: 1,
    verifyRetries: 0,
    ended: false,
    summary: '',
  };
  const caption = 'That airport feeling. Next stop: somewhere new. ✈️';
  for (const request of [
    'write an Instagram caption',
    'create a caption for my Instagram post',
    'actually i mean to have ig captions for the post. not subtitles',
    'Disable subtitles and write an Instagram caption',
  ]) {
    const current = { ...step, input: { request } };
    expect(postCaptionHandoffProblem(state, current, {})).toContain('actual ready-to-copy');
    expect(postCaptionHandoffProblem(state, current, { postCaption: caption })).toBeDefined();
    state.lastTurn = { phase: 'act', hadToolCalls: true, text: `Post caption:\n\n${caption}` };
    expect(postCaptionHandoffProblem(state, current, { postCaption: caption })).toBeUndefined();
    state.lastTurn = undefined;
  }
  for (const request of [
    'Make the subtitles larger',
    'Turn off captions for my reel',
    'Make captions for my reel larger',
    'Is this Instagram caption too long?',
    'I want to disable Instagram captions',
  ])
    expect(postCaptionHandoffProblem(state, { ...step, input: { request } }, {})).toBeUndefined();
});

it('retries the silent clarification handoff and delivers post copy without changing the timeline', async () => {
  const world = editorWorld();
  const timeline = world.v.timeline;
  const caption = 'That airport feeling. Next stop: somewhere new. ✈️';
  const output = { timelineId: timeline.id, revision: timeline.revision };
  const h = editorHarness(
    world,
    turns(
      { toolCalls: [call('timeline_get', { timelineId: timeline.id })] },
      { toolCalls: [call('handOff', output)] },
      { text: caption, toolCalls: [call('handOff', { ...output, postCaption: caption })] },
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
  expect(result.report).toBe(caption);
  expect(world.timelines.get(timeline.id)?.revision).toBe(timeline.revision);
  const events = await h.events(runId);
  expect(
    ofType(events, 'tool.failed').some((event) =>
      event.payload.error.detail?.includes('actual ready-to-copy'),
    ),
  ).toBe(true);
  expect(ofType(events, 'tool.requested').some((event) => event.payload.tool.startsWith('captions.'))).toBe(
    false,
  );
});
