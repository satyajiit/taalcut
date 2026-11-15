// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR1: a cover asked for in the editor's cover panel ("Generate with AI"). Its aspect travels as data: the brief
 * keeps it and tells the model, the message goes to the Editor whatever its words are, and the Editor's step cannot
 * hand off until a cover saved at that aspect in the run is exported at it.
 */
import { newId, unwrap, VIDEO_SIZES, type CoverRequest, type ThumbnailAspect } from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  editorBrief,
  editorRoute,
  MAKE_WORDS,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { coverHandoffProblem } from '../../src/editor/cover-completion';
import { initialState, type StepState, type ToolCallState } from '../../src/run-state';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

const COVER_NOTE = '# The cover the user asked for';
const ASPECTS = Object.keys(VIDEO_SIZES) as ThumbnailAspect[];

/** A docked run's Editor step, with the calls the run has made so far. */
function scenario(cover: CoverRequest | undefined, message = 'Generate a 9:16 cover for this video.') {
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
    editor: editorBrief(message, contextOf(world), timeline, cover),
  };
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const output = { timelineId: timeline.id, revision: 43 };
  const step: StepState = {
    id: 'cover',
    text: 'Cover',
    skill: 'timeline.editor',
    status: 'doing',
    turns: 1,
    verifyRetries: 0,
    ended: false,
    summary: '',
    input: { ...target, request: message },
  };
  const record = (tool: string, input: Record<string, unknown>, value: unknown, done = true) => {
    const id = newId<'ToolRun'>();
    const requested: ToolCallState['requested'] = {
      toolCallId: id,
      modelCallId: 'm1',
      modelToolCallId: `call-${state.toolCallOrder.length}`,
      tool,
      callName: tool.replace('.', '_'),
      meta: false,
      sideEffect: 'write',
      input,
    };
    const payload = {
      toolCallId: id,
      output: { kind: 'inline' as const, value },
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
  /** workspace.placeCover at an aspect, as the Editor saves a design over a frame of the video (CVR2). */
  const save = (aspect: ThumbnailAspect, on = target, done = true) =>
    record(
      'workspace.placeCover',
      {
        ...on,
        revision: 42,
        entry: 'cover/index.html',
        aspect,
        medium: 'footage',
        pictures: [{ name: 'hero', frame: 0 }],
        idea: 'The courtyard at dusk',
      },
      { timelineId: on.timelineId, revision: 43 },
      done,
    );
  /** render.exportCover's receipt at a size. */
  const exported = (width: number, height: number) =>
    record(
      'render.exportCover',
      { ...target, revision: 43 },
      { fileName: 'cover.jpg', width, height, revision: 43 },
    );
  const problem = (handoff: unknown = output, of: StepState = step) =>
    coverHandoffProblem(state, of, handoff);
  return { world, state, step, output, target, save, exported, problem };
}

describe('the brief of a cover asked for in the cover panel (CVR1)', () => {
  it('keeps the request, tells the model the aspect and the note, and goes to the Editor whatever the words are', () => {
    const world = editorWorld();
    const { timeline } = world.v;
    const context = contextOf(world);
    const cover = { aspect: '4:5', note: 'Make another one, from scratch?' } as const;
    const message = `Generate a 4:5 cover for this video. ${cover.note}`;
    // The note's own words would start a new video; the panel's request never does.
    expect(editorRoute(message)).toBe('make');
    const brief = editorBrief(message, context, timeline, cover);
    expect(brief).toMatchObject({ route: 'edit', cover });
    expect(brief.note).toContain(COVER_NOTE);
    expect(brief.note).toContain('they want a new cover for this video at 4:5');
    expect(brief.note).toContain('workspace.placeCover (aspect "4:5"');
    expect(brief.note).toContain('a frame saved as it is, is not that cover');
    expect(brief.note).toContain(JSON.stringify(cover));

    // Nor is a note that ends in a question mark a question to answer.
    const asked = 'Generate a 1:1 cover for this video. Night market?';
    expect(editorRoute(asked)).toBe('answer');
    expect(editorBrief(asked, context, timeline, { aspect: '1:1', note: 'Night market?' }).route).toBe(
      'edit',
    );

    const bare = editorBrief('Generate a 16:9 cover for this video.', context, timeline, { aspect: '16:9' });
    expect(bare.cover).toEqual({ aspect: '16:9' });
    expect(bare.note).toContain('{"aspect":"16:9"}');
    expect(bare.note).toContain('They left no note, so they named no medium');

    const plain = editorBrief('make this shorter', context, timeline);
    expect(plain).not.toHaveProperty('cover');
    expect(plain.note).not.toContain(COVER_NOTE);
  });
});

describe('the words the cover panel sends (CVR1)', () => {
  it('ask the Editor for a change at every aspect: no phrase that asks for a new video, no question', () => {
    // The panel's English message, as apps/renderer/test/cover-generate.test.tsx holds it to these same words
    // (the renderer cannot import this package to check them itself).
    for (const aspect of ASPECTS) {
      const words = `Generate a ${aspect} cover for this video.`;
      expect(editorRoute(words)).toBe('edit');
      for (const phrase of MAKE_WORDS) expect(words.toLowerCase()).not.toContain(phrase);
    }
  });
});

describe('the handoff of a cover asked for at an aspect (CVR1)', () => {
  it('passes once a cover saved at the aspect in this run is exported at it', async () => {
    const s = scenario({ aspect: '9:16' });
    const owing = await s.problem();
    expect(owing).toContain('owes a cover at 9:16');
    expect(owing).toContain('No cover was saved at 9:16 in this run');
    expect(owing).toContain('No JPEG at 9:16 for this timeline and revision is recorded.');
    expect(owing).toContain('workspace.placeCover and aspect "9:16"');
    s.save('9:16');
    expect(await s.problem()).toContain('No JPEG at 9:16');
    s.exported(1080, 1920);
    expect(await s.problem()).toBeUndefined();
    // The handoff still has to be this timeline's, at the exported revision.
    expect(await s.problem({ ...s.output, timelineId: newId<'Timeline'>() })).toContain(
      'timeline in this editing request',
    );
    expect(await s.problem({ ...s.output, revision: 44 })).toContain('No JPEG at 9:16');
  });

  it('refuses a cover saved and exported at another aspect, and says which aspect is owed', async () => {
    const s = scenario({ aspect: '9:16', note: 'The night market' });
    s.save('16:9');
    s.exported(1920, 1080);
    const wrong = await s.problem();
    expect(wrong).toContain('owes a cover at 9:16');
    expect(wrong).toContain('No cover was saved at 9:16 in this run');
    expect(wrong).toContain('The JPEG exported at this revision is 1920x1080, not 9:16.');
    // Saved at the right aspect, the wide JPEG is still not the cover asked for.
    s.save('9:16');
    expect(await s.problem()).toContain('1920x1080, not 9:16');
    s.exported(1080, 1920);
    expect(await s.problem()).toBeUndefined();
  });

  it('does not take an earlier cover exported again, a save that did not finish or another timeline’s save', async () => {
    const s = scenario({ aspect: '9:16' });
    s.exported(1080, 1920);
    const stale = await s.problem();
    expect(stale).toContain('No cover was saved at 9:16 in this run; exporting an earlier cover is not it.');
    expect(stale).not.toContain('No JPEG at 9:16');
    s.save('9:16', s.target, false);
    s.save('9:16', { ...s.target, timelineId: newId<'Timeline'>() });
    s.save('9:16', { ...s.target, projectId: newId<'Project'>() });
    expect(await s.problem()).toContain('No cover was saved at 9:16 in this run');
    s.save('9:16');
    expect(await s.problem()).toBeUndefined();
  });

  it('checks each of the four aspects by the JPEG’s own size', async () => {
    for (const aspect of ASPECTS) {
      const { width, height } = VIDEO_SIZES[aspect];
      for (const other of ASPECTS.filter((candidate) => candidate !== aspect)) {
        const s = scenario({ aspect });
        s.save(aspect);
        s.exported(VIDEO_SIZES[other].width, VIDEO_SIZES[other].height);
        expect(await s.problem()).toContain(`owes a cover at ${aspect}`);
      }
      const s = scenario({ aspect });
      s.save(aspect);
      // The same shape at twice the size is the same aspect.
      s.exported(width * 2, height * 2);
      expect(await s.problem()).toBeUndefined();
    }
  });

  it('owes the aspect whatever the words are, on the timeline it was asked on only', async () => {
    // No English cover word for the request's wording check to find: the aspect is data.
    const s = scenario({ aspect: '4:5' }, 'Genera una portada 4:5 para este video.');
    expect(await s.problem()).toContain('owes a cover at 4:5');
    const elsewhere = newId<'Timeline'>();
    const step = {
      ...s.step,
      input: { ...s.target, timelineId: elsewhere, request: 'make the subtitles larger' },
    };
    expect(await s.problem({ timelineId: elsewhere, revision: 43 }, step)).toBeUndefined();
    expect(await s.problem(s.output, { ...s.step, skill: 'timeline.maker' })).toBeUndefined();
  });

  it('accepts a limitation only when it is also visible to the person', async () => {
    const s = scenario({ aspect: '1:1' });
    const reason = 'Image generation is unavailable; no 1:1 cover was made.';
    const output = { ...s.output, notSavedCoverReason: reason };
    expect(await s.problem(output)).toContain('owes a cover at 1:1');
    s.state.lastTurn = { phase: 'act', hadToolCalls: true, text: reason };
    expect(await s.problem(output)).toBeUndefined();
  });

  it('checks a message without a cover request as before: any exported cover, no aspect owed', async () => {
    const s = scenario(undefined, 'make a thumbnail');
    expect(await s.problem()).toContain('No saved JPEG cover');
    s.exported(1920, 1080);
    expect(await s.problem()).toBeUndefined();
    expect(await scenario(undefined, 'make the subtitles larger').problem()).toBeUndefined();
  });
});

describe('a cover request through the chat (CVR1)', () => {
  it('is logged in the brief, on every prompt, on the message live and in history, and held at the handoff', async () => {
    const world = editorWorld();
    const { timeline } = world.v;
    const output = { timelineId: timeline.id, revision: timeline.revision };
    const reason = 'This test has no cover tools, so no 4:5 cover was saved.';
    const limitation = {
      text: reason,
      toolCalls: [call('handOff', { ...output, notSavedCoverReason: reason })],
    };
    const h = editorHarness(world, turns({ toolCalls: [call('handOff', output)] }, limitation, limitation));
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const conversationId = newId<'Conversation'>();
    const cover = { aspect: '4:5', note: 'The night market' } as const;
    const sent = unwrap(
      await chat.send(
        {
          conversationId,
          text: 'Genera una portada 4:5 para este video. The night market',
          editorContext: contextOf(world),
          cover,
        },
        { signal: new AbortController().signal },
      ),
    );
    for await (const event of sent.events) void event;
    expect(sent.userMessage.payload.cover).toEqual(cover);
    const { history } = unwrap(await chat.getConversation(conversationId));
    const message = history.find((event) => event.type === 'user.message');
    expect(message?.type === 'user.message' && message.payload.cover).toEqual(cover);

    const events = await h.events(sent.runId);
    expect(ofType(events, 'run.started')[0]?.payload.editor).toMatchObject({ route: 'edit', cover });
    expect(ofType(events, 'plan.created')[0]?.payload.steps).toEqual([
      expect.objectContaining({ skill: 'timeline.editor' }),
    ]);
    expect(h.models.requests.length).toBeGreaterThan(1);
    for (const request of h.models.requests) {
      expect(request.system).toContain(COVER_NOTE);
      expect(request.system).toContain('want a new cover for this video at 4:5');
    }
    // The silent handoff is refused with the aspect owed; the visible limitation then closes the step.
    expect(
      ofType(events, 'tool.failed').some((event) =>
        event.payload.error.detail?.includes('owes a cover at 4:5'),
      ),
    ).toBe(true);
    expect(unwrap(await h.agent.wait(sent.runId))).toMatchObject({ status: 'completed', report: reason });
  });

  it('drops a cover request that comes without the editor it was asked in', async () => {
    const world = editorWorld();
    const h = editorHarness(world, turns({ text: 'Done.' }));
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const sent = unwrap(
      await chat.send(
        { conversationId: newId<'Conversation'>(), text: 'A cover, please', cover: { aspect: '9:16' } },
        { signal: new AbortController().signal },
      ),
    );
    for await (const event of sent.events) void event;
    expect(sent.userMessage.payload).not.toHaveProperty('cover');
    expect(ofType(await h.events(sent.runId), 'run.started')[0]?.payload).not.toHaveProperty('editor');
  });
});
