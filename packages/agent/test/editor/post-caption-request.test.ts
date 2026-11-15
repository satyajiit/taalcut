// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: a post caption asked for in the editor's caption panel ("Generate with AI"). Its platform travels as
 * data: the brief keeps it and tells the model, the message goes to the Editor whatever its words are, and the
 * Editor's step cannot hand off until a caption for that platform was saved in the run.
 */
import {
  newId,
  POST_CAPTION_PLATFORMS,
  POST_CAPTION_RULES,
  unwrap,
  type PostCaptionRequest,
} from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  editorBrief,
  editorRoute,
  MAKE_WORDS,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { postCaptionNote, withPostCaption } from '../../src/editor/post-caption-brief';
import { postCaptionHandoffProblem } from '../../src/editor/post-caption-completion';
import { initialState, type StepState, type ToolCallState } from '../../src/run-state';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

const NOTE = '# The post caption the user asked for';
const CAPTION = 'Night market.\n\nCreated with @taalcut.app\n\n#hanoi\n\n(night market, street food, hanoi)';
const PARTS = {
  platform: 'instagram',
  body: 'Night market.',
  hashtags: ['hanoi'],
  keywords: ['night market', 'street food', 'hanoi'],
};

/** A docked run's Editor step for a caption asked in the panel, with the calls the run has made so far. */
function scenario(
  request: PostCaptionRequest | undefined,
  message = 'Write a caption for this video’s Instagram post.',
) {
  const world = editorWorld();
  const timeline = world.v.timeline;
  const state = initialState(newId<'AgentRun'>());
  state.started = {
    conversationId: 'c',
    message,
    autonomy: 'autopilot',
    budget: state.budget,
    localOnly: false,
    soulVersion: 'test',
    catalogueHash: 'test',
    editor: withPostCaption(editorBrief(message, contextOf(world), timeline), request),
  };
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const output = { timelineId: timeline.id, revision: timeline.revision + 1 };
  const step: StepState = {
    id: 'caption',
    text: 'Caption',
    skill: 'timeline.editor',
    status: 'doing',
    turns: 1,
    verifyRetries: 0,
    ended: false,
    summary: '',
    input: { ...target, request: message },
  };
  /** timeline.setPostCaption for a platform, as the tool answers it. */
  const save = (platform = 'instagram', on = target, done = true) => {
    const id = newId<'ToolRun'>();
    const requested: ToolCallState['requested'] = {
      toolCallId: id,
      modelCallId: 'm1',
      modelToolCallId: `call-${state.toolCallOrder.length}`,
      tool: 'timeline.setPostCaption',
      callName: 'timeline_setPostCaption',
      meta: false,
      sideEffect: 'write',
      input: { ...on, ...PARTS, platform },
    };
    const payload = {
      toolCallId: id,
      output: {
        kind: 'inline' as const,
        value: { timelineId: on.timelineId, revision: output.revision, platform, text: CAPTION },
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
  const problem = (handoff: unknown = output, of: StepState = step) =>
    postCaptionHandoffProblem(state, of, handoff);
  return { world, state, step, output, target, save, problem };
}

describe('the brief of a caption asked for in the caption panel (CAP1)', () => {
  it('keeps the request, tells the model the platform and the note, and goes to the Editor whatever the words are', () => {
    const world = editorWorld();
    const { timeline } = world.v;
    const context = contextOf(world);
    const request = { platform: 'instagram', note: 'Make another one, from scratch?' } as const;
    const message = `Write a caption for this video’s Instagram post. ${request.note}`;
    // The note's own words would start a new video; the panel's request never does.
    expect(editorRoute(message)).toBe('make');
    const plain = editorBrief(message, context, timeline);
    const brief = withPostCaption(plain, request);
    expect(brief).toMatchObject({ route: 'edit', postCaption: request });
    expect(brief.note.startsWith(plain.note)).toBe(true);
    expect(brief.note).toContain(NOTE);
    expect(brief.note).toContain('the caption to post under this video on Instagram');
    expect(brief.note).toContain("the post's own text, never subtitles");
    expect(brief.note).toContain('workspace.docs topic taalcut/edit-post-caption');
    expect(brief.note).toContain('timeline.setPostCaption and platform "instagram"');
    expect(brief.note).toContain('no clip, text, graphic, subtitle or export');
    expect(brief.note).toContain(JSON.stringify(request));

    const bare = withPostCaption(plain, { platform: 'instagram' });
    expect(bare.postCaption).toEqual({ platform: 'instagram' });
    expect(bare.note).toContain('{"platform":"instagram"}');
    expect(bare.note).toContain('They left no note');

    // A message with no request keeps its brief as it is, to the letter.
    expect(withPostCaption(plain, undefined)).toBe(plain);
    expect(plain).not.toHaveProperty('postCaption');
    expect(plain.note).not.toContain(NOTE);
  });

  it('names each platform of the rule table by its own name', () => {
    for (const platform of POST_CAPTION_PLATFORMS)
      expect(postCaptionNote({ platform })).toContain(`on ${POST_CAPTION_RULES[platform].name} (`);
  });
});

describe('the words the caption panel sends (CAP1)', () => {
  it('ask the Editor for a change for every platform: no phrase that asks for a new video, no question', () => {
    // The panel's English message, as apps/renderer/test/post-caption-states.test.tsx holds it to these same
    // words (the renderer cannot import this package to check them itself).
    for (const platform of POST_CAPTION_PLATFORMS) {
      const words = `Write a caption for this video’s ${POST_CAPTION_RULES[platform].name} post.`;
      expect(editorRoute(words)).toBe('edit');
      for (const phrase of MAKE_WORDS) expect(words.toLowerCase()).not.toContain(phrase);
    }
  });
});

describe('the handoff of a caption asked for in the panel (CAP1)', () => {
  it('is refused with no caption saved, and passes once one is saved for the platform in this run', async () => {
    const s = scenario({ platform: 'instagram' });
    expect(await s.problem()).toBe(
      "The user asked for this Instagram caption in the editor's caption panel, so the step owes a caption " +
        'saved for instagram. None was saved in this run. Read what the video shows with timeline.get, then ' +
        'save the caption\'s parts with timeline.setPostCaption and platform "instagram"; when it refuses, it ' +
        'says what to fix. If the caption cannot be written, explain that visibly and repeat the explanation ' +
        'verbatim in handOff.notSavedPostCaptionReason.',
    );
    s.save();
    // The panel shows the saved text, so the answer need not repeat it.
    expect(await s.problem()).toBeUndefined();
  });

  it('does not take a save that did not finish, or one on another video or project', async () => {
    const s = scenario({ platform: 'instagram', note: 'Mention the lanterns' });
    s.save('instagram', s.target, false);
    s.save('instagram', { ...s.target, timelineId: newId<'Timeline'>() });
    s.save('instagram', { ...s.target, projectId: newId<'Project'>() });
    expect(await s.problem()).toContain('None was saved in this run');
    s.save();
    expect(await s.problem()).toBeUndefined();
  });

  it('owes the caption whatever the words are, on the timeline it was asked on only', async () => {
    // No English word for the chat's wording check to find: the request is data.
    const s = scenario({ platform: 'instagram' }, 'Escribe el texto para Instagram de este video.');
    expect(await s.problem()).toContain('owes a caption saved for instagram');
    const elsewhere = newId<'Timeline'>();
    const step = {
      ...s.step,
      input: { ...s.target, timelineId: elsewhere, request: 'make the subtitles larger' },
    };
    expect(await s.problem({ timelineId: elsewhere, revision: 3 }, step)).toBeUndefined();
    expect(await s.problem(s.output, { ...s.step, skill: 'timeline.maker' })).toBeUndefined();
  });

  it('accepts a limitation only when it is also visible to the person', async () => {
    const s = scenario({ platform: 'instagram' });
    const reason = 'The video has no clips yet, so there is nothing to write a caption from.';
    const output = { ...s.output, notSavedPostCaptionReason: reason };
    expect(await s.problem(output)).toContain('owes a caption saved for instagram');
    s.state.lastTurn = { phase: 'act', hadToolCalls: true, text: reason };
    expect(await s.problem(output)).toBeUndefined();
  });
});

describe('a caption request through the chat (CAP1)', () => {
  it('is logged in the brief, on every prompt, on the message live and in history, and held at the handoff', async () => {
    const world = editorWorld();
    const { timeline } = world.v;
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const before = { timelineId: timeline.id, revision: timeline.revision };
    const after = { timelineId: timeline.id, revision: timeline.revision + 1 };
    const h = editorHarness(
      world,
      turns(
        { toolCalls: [call('handOff', before)] },
        { toolCalls: [call('timeline_setPostCaption', { ...target, ...PARTS })] },
        { text: 'Your Instagram caption is saved with the video.', toolCalls: [call('handOff', after)] },
      ),
    );
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const conversationId = newId<'Conversation'>();
    const postCaption = { platform: 'instagram', note: 'Mention the lanterns' } as const;
    const sent = unwrap(
      await chat.send(
        {
          conversationId,
          text: 'Escribe el texto para Instagram de este video. Mention the lanterns',
          editorContext: contextOf(world),
          postCaption,
        },
        { signal: new AbortController().signal },
      ),
    );
    for await (const event of sent.events) void event;
    expect(sent.userMessage.payload.postCaption).toEqual(postCaption);
    const { history } = unwrap(await chat.getConversation(conversationId));
    const message = history.find((event) => event.type === 'user.message');
    expect(message?.type === 'user.message' && message.payload.postCaption).toEqual(postCaption);

    const events = await h.events(sent.runId);
    expect(ofType(events, 'run.started')[0]?.payload.editor).toMatchObject({ route: 'edit', postCaption });
    expect(ofType(events, 'plan.created')[0]?.payload.steps).toEqual([
      expect.objectContaining({ skill: 'timeline.editor' }),
    ]);
    expect(h.models.requests.length).toBeGreaterThan(1);
    for (const request of h.models.requests) {
      expect(request.system).toContain(NOTE);
      expect(request.system).toContain('the caption to post under this video on Instagram');
    }
    // The silent handoff is refused with the caption owed; the save then closes the step.
    expect(
      ofType(events, 'tool.failed').some((event) =>
        event.payload.error.detail?.includes('owes a caption saved for instagram'),
      ),
    ).toBe(true);
    expect(unwrap(await h.agent.wait(sent.runId))).toMatchObject({ status: 'completed' });
    expect(world.timelines.get(timeline.id)?.postCaptions).toEqual([
      { platform: 'instagram', text: CAPTION, writtenBy: 'ai' },
    ]);
    // A caption is no edit to the video's items: the run sends no changes card.
    expect(ofType(events, 'card.sent').some((event) => event.payload.card.type === 'editChanges')).toBe(
      false,
    );
  });

  it('drops a caption request that comes without the editor it was asked in', async () => {
    const world = editorWorld();
    const h = editorHarness(world, turns({ text: 'Done.' }));
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const sent = unwrap(
      await chat.send(
        {
          conversationId: newId<'Conversation'>(),
          text: 'Write a caption for this video’s Instagram post.',
          postCaption: { platform: 'instagram' },
        },
        { signal: new AbortController().signal },
      ),
    );
    for await (const event of sent.events) void event;
    expect(sent.userMessage.payload).not.toHaveProperty('postCaption');
    const events = await h.events(sent.runId);
    expect(ofType(events, 'run.started')[0]?.payload.editor).toBeUndefined();
  });
});
