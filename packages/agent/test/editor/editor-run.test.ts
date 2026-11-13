// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX in a run (SPEC section 38): a docked change goes to the Editor with no planning turn; every model turn
 * sees the editor; the run ends with the changes card, which stands for the Editor's own card; questions and
 * requests for a new video plan as before, and only the latter may start the make flow.
 */
import { newId, unwrap, type ChatEvent } from '@taalcut/core';
import { createChatService, createMemoryConversationStore } from '@taalcut/agent';
import { describe, expect, it, vi } from 'vitest';
import { flowHarness } from '../support/flow-harness';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld, type EditorWorld } from './editor-support';

const NOTE = '# The editor, as the user sees it';
const clip = (world: EditorWorld, n: number) => world.v.clipIds.filter((id) => id !== null)[n - 1]!;

/** The Editor trims clip 2 by 15 frames (half a second), then hands off. */
function trimScript(world: EditorWorld) {
  const { timeline } = world.v;
  return turns(
    {
      toolCalls: [call('timeline_trimClip', { timelineId: timeline.id, clipId: clip(world, 2), frames: 15 })],
    },
    {
      text: 'Clip 2 is half a second shorter.',
      toolCalls: [call('handOff', { timelineId: timeline.id, revision: 4 })],
    },
  );
}

describe('a docked change (EDT1-CTX)', () => {
  it('goes to the Editor with no planning turn, every turn sees the editor, and the changes card closes it', async () => {
    const world = editorWorld();
    const h = editorHarness(world, trimScript(world));
    const editorContext = contextOf(world, { selection: [clip(world, 2)] });
    const runId = unwrap(
      await h.agent.start({ conversationId: 'c', message: 'make this clip shorter', editorContext }),
    );
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome.status).toBe('completed');
    expect(outcome.report).toBe('Clip 2 is half a second shorter.');
    const events = await h.events(runId);

    const plan = ofType(events, 'plan.created')[0]!.payload.steps;
    expect(plan).toEqual([
      expect.objectContaining({
        // The kinds of what is pointed at go with the words: they search the tool catalogue.
        text: 'make this clip shorter (selected: clip)',
        skill: 'timeline.editor',
        input: expect.objectContaining({
          timelineId: world.v.timeline.id,
          templateId: world.v.template.id,
          request: 'make this clip shorter',
          targets: [expect.objectContaining({ itemId: clip(world, 2) })],
          // The editor as the user saw it: the selection and the playhead, for "here" with nothing pointed at.
          context: editorContext,
        }),
      }),
    ]);
    // No planning turn: the first request is the Editor's, with its handOff.
    expect(h.models.requests[0]?.tools?.map((tool) => tool.name)).toContain('handOff');
    for (const request of h.models.requests) expect(request.system).toContain(NOTE);
    expect(ofType(events, 'run.started')[0]?.payload.editor).toMatchObject({
      route: 'edit',
      context: editorContext,
    });
    // EDT1-OPS: the Editor's tools see what the person pointed at, to check a change against it.
    expect(world.toolEditors).toEqual([
      { context: editorContext, targets: [expect.objectContaining({ itemId: clip(world, 2) })] },
    ]);

    const cards = ofType(events, 'card.sent').map((event) => event.payload.card);
    expect(cards.map((card) => card.type)).toEqual(['editChanges']);
    expect(cards[0]).toMatchObject({
      group: `turn:${runId}`,
      revisionBefore: 3,
      revisionAfter: 4,
      changes: [expect.objectContaining({ number: 2, change: { kind: 'length', before: 2.1, after: 1.6 } })],
      more: 0,
    });
  });

  it('sends no changes card when the turn changed nothing', async () => {
    const world = editorWorld();
    const { timeline } = world.v;
    const h = editorHarness(
      world,
      turns(
        { toolCalls: [call('handOff', { timelineId: timeline.id, revision: 3 })] },
        { text: 'Nothing to change.' },
      ),
    );
    const runId = unwrap(
      await h.agent.start({ conversationId: 'c', message: 'tidy this', editorContext: contextOf(world) }),
    );
    unwrap(await h.agent.wait(runId));
    expect(ofType(await h.events(runId), 'card.sent')).toEqual([]);
  });

  it('runs as a plain message without the editor resolver', async () => {
    const world = editorWorld();
    const h = editorHarness(world, turns({ text: 'Done.' }), { resolver: false });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        message: 'make this shorter',
        editorContext: contextOf(world),
      }),
    );
    unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);
    expect(ofType(events, 'run.started')[0]?.payload).not.toHaveProperty('editor');
    expect(h.models.requests[0]?.system).not.toContain(NOTE);
  });
});

describe('docked questions and new videos (EDT1-CTX)', () => {
  const planned = async (message: string) => {
    const world = editorWorld();
    const h = flowHarness({
      script: turns({ text: 'It opens the video.' }),
      deps: { phase3: { editor: world.resolver } },
    });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message,
        editorContext: contextOf(world),
      }),
    );
    unwrap(await h.agent.wait(runId));
    return h.models.requests[0]!;
  };

  it('answers a question in a planning turn that offers no flow', async () => {
    const first = await planned('Why is this clip here?');
    expect(first.tools?.map((tool) => tool.name)).not.toContain('startFlow');
    expect(first.system).toContain(NOTE);
  });

  it('offers the make flow only when the words ask for a new video', async () => {
    const first = await planned('Make a new version with my beach clips');
    expect(first.tools?.map((tool) => tool.name)).toContain('startFlow');
  });
});

describe('the docked composer through the chat (EDT1-CTX)', () => {
  it('keeps the editor context on the message, live and in history, and links the chat by its timeline', async () => {
    const world = editorWorld();
    const h = editorHarness(world, trimScript(world));
    const linkProject = vi.fn().mockResolvedValue(null);
    const chat = createChatService({
      agent: h.agent,
      conversations: createMemoryConversationStore(),
      linkProject,
    });
    const conversationId = newId<'Conversation'>();
    const editorContext = contextOf(world, { selection: [clip(world, 2)] });
    const sent = unwrap(
      await chat.send(
        { conversationId, text: 'make this clip shorter', editorContext },
        { signal: new AbortController().signal },
      ),
    );
    const live: ChatEvent[] = [];
    for await (const event of sent.events) live.push(event);
    expect(sent.userMessage.payload.editorContext).toEqual(editorContext);
    expect(linkProject).toHaveBeenCalledWith(conversationId, [], world.v.timeline.id);
    expect(
      live.some((event) => event.type === 'agent.card' && event.payload.card.type === 'editChanges'),
    ).toBe(true);
    const { history } = unwrap(await chat.getConversation(conversationId));
    const message = history.find((event) => event.type === 'user.message');
    expect(message?.type === 'user.message' && message.payload.editorContext).toEqual(editorContext);
  });
});
