// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Chat titles: clean provisional titles (stripping canned starter prefixes,
 * file paths and social URLs), followed by 1–2 message adaptive AI titling
 * through the ModelClient without overwriting user-renamed conversations or
 * bumping updatedAt.
 */
import { newId, ok, unwrap, type CloudCallRecord, type ConversationId, type RunId } from '@taalcut/core';
import {
  createChatService,
  createConversationTitler,
  createMemoryConversationStore,
  createScriptedModelClient,
  provisionalTitle,
  tidyTitle,
  type ChatEvent,
  type ModelScript,
} from '@taalcut/agent';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanTitle,
  createChatTitling,
   isManagedTitle,
  TITLE_MAX_TOKENS,
} from '../src/chat-titles';
import { isProceduralOpener } from '../src/chat-title-format';
import { call, harness, plan, turns } from './support/harness';

const LONG = "Add my Desktop/Trip folder and tell me what's in the first video.";

async function drain(events: AsyncIterable<ChatEvent>) {
  for await (const _ of events);
}

function setup(titleScript?: ModelScript, agentScript?: ModelScript) {
  let step = 0;
  const seqReplies = [
    plan('Look'),
    { text: 'The first video shows a beach at dawn.' },
    plan('Look again'),
    { text: 'The second video shows Hawa Mahal at sunrise with warm color grading.' },
    plan('Export'),
    { text: 'Exported in 4K.' },
  ];
  const h = harness({
    script: agentScript ?? (() => seqReplies[Math.min(step++, seqReplies.length - 1)]!),
  });
  const baseStore = createMemoryConversationStore();
  const renameCalls: { id: ConversationId; title: string; options?: { preserveUpdatedAt?: boolean } }[] = [];
  const conversations = {
    ...baseStore,
    async rename(id: ConversationId, title: string, options?: { preserveUpdatedAt?: boolean }) {
      renameCalls.push({ id, title, ...(options ? { options } : {}) });
      return baseStore.rename(id, title);
    },
  };
  const calls: CloudCallRecord[] = [];
  const titleModels = titleScript
    ? createScriptedModelClient(titleScript, { callLog: { record: (r) => calls.push(r) } })
    : undefined;
  const changed: { id: ConversationId; title: string }[] = [];
  const named: { id: ConversationId; title: string }[] = [];
  const chat = createChatService({
    agent: h.agent,
    conversations,
    ...(titleModels ? { titles: createConversationTitler(titleModels) } : {}),
    onConversationChanged: (c) => changed.push(c),
    onConversationNamed: (c) => {
      named.push(c);
    },
  });
  const conversationId = newId<'Conversation'>();
  const send = async (text: string) => {
    const sent = unwrap(await chat.send({ conversationId, text }, { signal: new AbortController().signal }));
    await drain(sent.events);
  };
  const titleOf = async () => unwrap(await conversations.get(conversationId)).conversation.title;
  return {
    chat,
    conversations,
    conversationId,
    send,
    titleOf,
    changed,
    named,
    calls,
    titleModels,
    renameCalls,
  };
}

describe('provisional titles', () => {
  it('keeps a short message as it is, and cuts a long one at a word with an ellipsis', () => {
    expect(provisionalTitle('  Make a  reel ')).toBe('Make a reel');
    expect(provisionalTitle(LONG)).toBe("Add my Desktop/Trip folder and tell me what's…");
    expect(provisionalTitle(LONG).length).toBeLessThanOrEqual(48);
    expect(provisionalTitle('x'.repeat(60))).toBe(`${'x'.repeat(47)}…`);
  });

  it('strips canned prefixes and extracts clean titles from local file paths and noise tokens', () => {
    expect(provisionalTitle('/Users/demo/Desktop/jaipur-sunrise.mp4')).toBe('Jaipur sunrise');
    expect(provisionalTitle('Make a video like this reel: /Users/demo/Desktop/jaipur-dawn-reel.mp4')).toBe(
      'Jaipur dawn reel',
    );
    expect(provisionalTitle('make a video like this reel: C:\\Videos\\summer_trip_2026.mov')).toBe(
      'Summer trip 2026',
    );
    expect(provisionalTitle('Create a video from /Users/demo/Desktop/jaipur-sunrise.mp4')).toBe(
      'Jaipur sunrise',
    );
    expect(provisionalTitle('Make a video from /Users/demo/Clips/IMG_4821_jaipur_market_1920x1080.mp4')).toBe(
      'Jaipur market',
    );
    expect(provisionalTitle('Make a video from /Users/demo/Clips/DSC_0042_monsoon_chai_4k60.mov')).toBe(
      'Monsoon chai',
    );
    expect(provisionalTitle('Make a video with my template “Goa Weekend”')).toBe('Goa Weekend');
    expect(provisionalTitle('Make a video in the Fast Cut format')).toBe('Fast Cut format');
    expect(provisionalTitle('Make a video from my latest clips')).toBe('Latest clips');
  });

  it('formats social reel URLs into clean provisional titles instead of raw URLs', () => {
    expect(
      provisionalTitle('Make a video like this reel: https://www.instagram.com/reel/C8abc123xyz/?igsh=1'),
    ).toBe('Instagram reel breakdown');
    expect(provisionalTitle('Make a video like this reel: https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'YouTube Short breakdown',
    );
    expect(provisionalTitle('https://www.tiktok.com/@creator/video/7123456789')).toBe(
      'TikTok reel breakdown',
    );
  });

  it('recognizes new clean provisional titles, legacy 48-char cuts, and AI stage-1 titles as managed', () => {
    const prompt = 'Make a video like this reel: /Users/demo/Desktop/jaipur-dawn-reel.mp4';
    expect(isManagedTitle('Jaipur dawn reel', prompt)).toBe(true);
    expect(isManagedTitle(prompt.slice(0, 48), prompt)).toBe(true);
    expect(isManagedTitle('Jaipur Dawn Travel Reel', prompt, 'Jaipur Dawn Travel Reel')).toBe(true);
    expect(isManagedTitle('My Custom Rename', prompt, 'Jaipur Dawn Travel Reel')).toBe(false);
  });

  it('keeps the subject beside embedded references instead of URLs, tracking queries or paths', () => {
    expect(
      provisionalTitle(
        'lets create from https://www.instagram.com/reel/example/?utm_source=shared , we can use our airport, plan and related shots .',
      ),
    ).toBe('Airport, plan and related shots');
    expect(
      provisionalTitle('Please create from https://example.com/reference with my monsoon market footage'),
    ).toBe('Monsoon market footage');
    expect(
      provisionalTitle('Create a video from /Users/demo/Clips/reference.mov with my night market shots'),
    ).toBe('Night market shots');
    expect(
      provisionalTitle('Create a video from "C:\\Clips\\reference edit.mov" with our mountain hike clips'),
    ).toBe('Mountain hike clips');
    expect(
      provisionalTitle('lets create from https://www.instagram.com/reel/example/?utm_source=shared'),
    ).toBe('Instagram reel breakdown');
    expect(
      provisionalTitle(
        'lets make a reels like https://www.instagram.com/reel/De_KQwpIAQf/?utm_source=ig_web_copy_link&igsh=NTc4MTIwNjQ2YQ== , from my footages.',
      ),
    ).toBe('Instagram reel breakdown');
    expect(provisionalTitle('Trim the first 3/4 of the clip')).toBe('Trim the first 3/4 of the clip');
  });
});

describe('cleanTitle / tidyTitle', () => {
  it('takes the first line, strips quotes/markdown/labels/trailing punctuation, and clamps to 60 chars', () => {
    expect(tidyTitle('"Beach video at dawn."')).toBe('Beach video at dawn');
    expect(tidyTitle('Title: Trip folder\nBecause it is about a trip')).toBe('Trip folder');
    expect(cleanTitle('**Title:** **Jaipur Dawn Travel Reel!**')).toBe('Jaipur Dawn Travel Reel');
    expect(cleanTitle('Travel Reel Reference Matching')).toBe('Travel Reel');
    expect(cleanTitle('Reference Matching')).toBeUndefined();
    expect(
      isProceduralOpener(
        'The reference’s 15 shots are mapped. I’m saving their timing and shot notes for matching against your footage.\n\nThe 15-shot template is ready; I’m now matching your clips to its slots and building the cut.',
      ),
    ).toBe(true);
    expect(tidyTitle('one two three four five six seven eight')).toBe('one two three four five six');
    expect(tidyTitle('«Vidéo de la plage»')).toBe('Vidéo de la plage');
    expect(cleanTitle('supercalifragilisticexpialidocious '.repeat(3))!.length).toBeLessThanOrEqual(60);
    expect(tidyTitle('  \n ')).toBeUndefined();
  });
});

describe('1–2 message adaptive chat titling', () => {
  it('sets a stage 1 title after message 1, refines to stage 2 after message 2, and stops before message 3', async () => {
    let callCount = 0;
    const s = setup(() => {
      callCount += 1;
      return {
        text: callCount === 1 ? '"Beach video at dawn."' : '"Jaipur Sunrise Color Grade"',
        provider: 'openai',
        model: 'gpt-5.4-nano',
      };
    });

    await s.send(LONG);
    await vi.waitFor(async () => expect(await s.titleOf()).toBe('Beach video at dawn'));
    expect(s.changed).toEqual([{ id: s.conversationId, title: 'Beach video at dawn' }]);
    expect(s.named).toEqual(s.changed);
    expect(s.renameCalls[0]).toEqual({
      id: s.conversationId,
      title: 'Beach video at dawn',
      options: { preserveUpdatedAt: true },
    });

    const [firstReq] = s.titleModels!.requests;
    expect(firstReq).toMatchObject({ module: 'agent', reasoning: 'off', maxTokens: TITLE_MAX_TOKENS });
    expect(firstReq!.messages).toEqual([
      { role: 'user', content: `User: ${LONG}\n\nTaalcut: The first video shows a beach at dawn.` },
    ]);
    expect(s.calls).toMatchObject([{ module: 'agent' }]);

    // Stage 2: refines after the 2nd user message + assistant response.
    await s.send('Focus on Hawa Mahal at sunrise and add a warm grade.');
    await vi.waitFor(async () => expect(await s.titleOf()).toBe('Jaipur Sunrise Color Grade'));
    expect(s.titleModels!.requests).toHaveLength(2);
    const secondPrompt = JSON.stringify(s.titleModels!.requests[1]!.messages);
    expect(secondPrompt).toContain('Focus on Hawa Mahal at sunrise and add a warm grade.');
    expect(secondPrompt).toContain('The second video shows Hawa Mahal at sunrise with warm color grading.');

    // Stage 2 is terminal: message 3 does not trigger another title call.
    await s.send('Export it now.');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(s.titleModels!.requests).toHaveLength(2);
    expect(await s.titleOf()).toBe('Jaipur Sunrise Color Grade');
  });

  it("prefers the agent's model and falls back to router when agent is unavailable or returns empty", async () => {
    const s = setup((request) =>
      request.module === 'agent'
        ? { error: { code: 'models.no_model_for_module', messageKey: 'x', retryable: false } }
        : { text: 'Trip video' },
    );
    await s.send(LONG);
    await vi.waitFor(async () => expect(await s.titleOf()).toBe('Trip video'));
    expect(s.titleModels!.requests.map((r) => r.module)).toEqual(['agent', 'router']);
  });

  it('retries on the next turn when the model returns empty on the first attempt', async () => {
    let attempt = 0;
    const s = setup(() => {
      attempt += 1;
      // First two module tries on turn 1 return empty; turn 2 succeeds.
      return { text: attempt <= 2 ? '   ' : 'Jaipur Dawn Reel' };
    });
    await s.send(LONG);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await s.titleOf()).toBe(provisionalTitle(LONG));

    await s.send('Tighten the hook.');
    await vi.waitFor(async () => expect(await s.titleOf()).toBe('Jaipur Dawn Reel'));
  });

  it('keeps the provisional title without a model, and respects manual renames before stage 1 or stage 2', async () => {
    const none = setup();
    await none.send(LONG);
    expect(await none.titleOf()).toBe(provisionalTitle(LONG));
    expect(none.changed).toEqual([]);

    const renamed = setup(() => ({ text: 'Model title' }));
    const conversation = unwrap(
      await renamed.conversations.create({ id: renamed.conversationId, title: 'My trip' }),
    );
    expect(conversation.title).toBe('My trip');
    await renamed.send(LONG);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await renamed.titleOf()).toBe('My trip');
    expect(renamed.titleModels!.requests).toEqual([]);

    // User manually renames after Stage 1 -> Stage 2 must not overwrite it.
    let n = 0;
    const midRename = setup(() => ({ text: ++n === 1 ? 'Initial AI Title' : 'Second AI Title' }));
    await midRename.send(LONG);
    await vi.waitFor(async () => expect(await midRename.titleOf()).toBe('Initial AI Title'));
    unwrap(await midRename.conversations.rename(midRename.conversationId, 'User Custom Name'));
    await midRename.send('Second message');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await midRename.titleOf()).toBe('User Custom Name');
    expect(midRename.titleModels!.requests).toHaveLength(1);
  });

  it('skips paused procedural openers and titles once the run completes or turn 2 has substance', async () => {
    const deleteScript = turns(
      plan('Delete clip'),
      { text: 'I will move clip c1 to the Trash.', toolCalls: [call('clips_deleteClip', { id: 'c1' })] },
      { text: 'Deleted blurry beach clip c1 from the timeline.' },
    );
    const s = setup(() => ({ text: 'Remove Blurry Beach Clip' }), deleteScript);
    const sent = unwrap(
      await s.chat.send(
        { conversationId: s.conversationId, text: 'delete c1' },
        { signal: new AbortController().signal },
      ),
    );
    const firstEvents: ChatEvent[] = [];
    for await (const e of sent.events) firstEvents.push(e);
    await new Promise((resolve) => setTimeout(resolve, 25));
    // Paused on approval with only a procedural line: should not have wasted a title call yet.
    expect(s.titleModels!.requests).toHaveLength(0);

    const asked = firstEvents.find((e) => e.type === 'agent.approvalRequested');
    const approvalId = asked?.type === 'agent.approvalRequested' ? asked.payload.approvalId : '';
    unwrap(await s.chat.decideApproval({ runId: sent.runId, approvalId, decision: 'approve' }));
    await vi.waitFor(async () => expect(await s.titleOf()).toBe('Remove Blurry Beach Clip'));
    expect(s.titleModels!.requests).toHaveLength(1);
  });

  it('recovers when the first run is tool-only (using tool/card summaries or turn 2 assistant text)', async () => {
    const conversationId = newId<'Conversation'>();
    const run1 = newId<'AgentRun'>();
    const run2 = newId<'AgentRun'>();
    let storedMessages: {
      id: ReturnType<typeof newId<'Message'>>;
      role: 'user' | 'assistant';
      parts: { type: 'text'; text: string }[];
      runId: RunId;
      createdAt: number;
    }[] = [
      {
        id: newId<'Message'>(),
        role: 'user',
        parts: [
          { type: 'text', text: 'Make a video like this reel: /Users/demo/Desktop/jaipur-sunrise.mp4' },
        ],
        runId: run1,
        createdAt: 1,
      },
    ];
    const storedToolRuns = [
      {
        id: 'tr-1',
        runId: run1,
        tool: 'template.breakdownReel',
        status: 'succeeded',
        summary: '14 beat slots extracted from Jaipur sunrise reel',
      },
    ];
    let currentTitle = provisionalTitle(storedMessages[0]!.parts[0]!.text);
    const titlerCalls: { user: string; answer: string }[] = [];

    const titling = createChatTitling({
      conversations: {
        create: async () => ok({ id: conversationId, title: currentTitle, createdAt: 1, updatedAt: 1 }),
        list: async () => ok([]),
        get: async () =>
          ok({
            conversation: { id: conversationId, title: currentTitle, createdAt: 1, updatedAt: 1 },
            messages: storedMessages,
            runs: [{ runId: run1 }, { runId: run2 }],
            toolRuns: storedToolRuns,
          } as never),
        appendMessage: async () => ok(undefined),
        linkRun: async () => ok(undefined),
        rename: async (_id, title) => {
          currentTitle = title;
          return ok({ id: conversationId, title, createdAt: 1, updatedAt: 1 });
        },
      },
      titles: async ({ user, answer }) => {
        titlerCalls.push({ user, answer });
        return titlerCalls.length === 1 ? 'Jaipur Sunrise Breakdown' : 'Jaipur Sunrise Warm Grade';
      },
    });

    // Turn 1 has no assistant message, only a toolRun summary -> Stage 1 titles from toolRun summary!
    await titling(conversationId);
    expect(currentTitle).toBe('Jaipur Sunrise Breakdown');
    expect(titlerCalls[0]!.answer).toContain('14 beat slots extracted from Jaipur sunrise reel');

    // Turn 2 adds a second user message and assistant message -> Stage 2 refines the title!
    storedMessages = [
      ...storedMessages,
      {
        id: newId<'Message'>(),
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Apply a warm golden hour color grade' }],
        runId: run2,
        createdAt: 2,
      },
      {
        id: newId<'Message'>(),
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Applied warm golden hour color grade across all 14 shots.' }],
        runId: run2,
        createdAt: 3,
      },
    ];
    await titling(conversationId);
    expect(currentTitle).toBe('Jaipur Sunrise Warm Grade');
    expect(titlerCalls).toHaveLength(2);
  });
});
