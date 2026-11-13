// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TOOLGROUPS: what each tool call was about ("IMG_0412.MOV · 0:48") reaches the chat on agent.toolFinished,
 * live and from history alike, and the ui card; it never reaches the model, and a debug bundle drops it.
 */
import {
  callClock,
  defineTool,
  defineToolModule,
  err,
  fileNameOf,
  newId,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  unwrap,
} from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  redactRunEvent,
  type ChatEvent,
  type ChatHistoryEvent,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { call, harness, ofType, plan, toolText, turns } from './support/harness';

const inspect = defineTool({
  name: 'clips.inspect',
  version: '1.0.0',
  description: 'One clip’s length.',
  tags: ['clip'],
  input: z.object({ path: z.string() }),
  output: z.object({ seconds: z.number(), caption: z.string() }),
  costClass: 'local',
  sideEffect: 'read',
  timeoutMs: 1_000,
  retry: NO_TOOL_RETRY,
  run: async ({ path }) =>
    path.endsWith('.MOV')
      ? ok({ seconds: 48 + path.length, caption: 'Waves on the beach at dusk' })
      : err(NotFoundError({ entity: 'clip', id: 'gone' })),
  // The file's name and length; never its caption.
  describeCall: (input, output) => `${fileNameOf(input.path)} · ${callClock(output.seconds)}`,
});
const MODULES = [defineToolModule({ id: 'clips', tools: [inspect] })];

const PATHS = ['/Users/me/Trip/IMG_0412.MOV', '/Users/me/Trip/IMG_0413.MOV', '/Users/me/Trip/notes.txt'];
const SAID = [
  `IMG_0412.MOV · ${callClock(48 + PATHS[0]!.length)}`,
  `IMG_0413.MOV · ${callClock(48 + PATHS[1]!.length)}`,
];

const script = turns(
  plan('Inspect the clips'),
  { toolCalls: PATHS.map((path) => call('clips_inspect', { path })) },
  { text: 'Two clips; the notes are gone.' },
);

async function collect(events: AsyncIterable<ChatEvent>) {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

/** Each finished call: its status and its summary, in the order they finished. */
const finishedOf = (events: readonly ChatHistoryEvent[]) =>
  events.flatMap((e) =>
    e.type === 'agent.toolFinished' ? [{ status: e.payload.status, summary: e.payload.summary }] : [],
  );
const sorted = <T extends { summary?: string | undefined }>(rows: T[]) =>
  [...rows].sort((a, b) => String(a.summary).localeCompare(String(b.summary)));

describe('a tool call’s summary', () => {
  it('reaches agent.toolFinished live and from history, the same, and only for calls that answered', async () => {
    const h = harness({ script, modules: MODULES });
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const conversationId = newId<'Conversation'>();
    const signal = new AbortController().signal;
    const sent = unwrap(await chat.send({ conversationId, text: 'Inspect my Trip clips' }, { signal }));
    const live = finishedOf(await collect(sent.events));

    expect(sorted(live)).toEqual([
      { status: 'succeeded', summary: SAID[0] },
      { status: 'succeeded', summary: SAID[1] },
      { status: 'failed', summary: undefined },
    ]);
    const { history } = unwrap(await chat.getConversation(conversationId));
    expect(finishedOf(history)).toEqual(live);
    // Never a folder, and never the tool's caption.
    expect(JSON.stringify(live)).not.toMatch(/Users|Trip\/|Waves/);
    chat.close();
  });

  it('is on the ui card and in the run log, but not in what the model reads', async () => {
    const h = harness({ script, modules: MODULES });
    const result = unwrap(await h.agent.run({ conversationId: 'c', message: 'Inspect my Trip clips' }));
    const cards = h.ui.flatMap((e) =>
      e.type === 'agent.card' && e.card.kind === 'toolRun' && e.card.status === 'done'
        ? [e.card.summary]
        : [],
    );
    expect([...cards].sort()).toEqual(SAID);

    const events = await h.events(result.runId);
    const completed = ofType(events, 'tool.completed').filter((e) => e.payload.summary);
    expect(completed.map((e) => e.payload.summary).sort()).toEqual(SAID);

    const asked = h.models.requests.at(-1)!.messages.map(toolText).join('\n');
    expect(asked).toContain('Waves on the beach');
    expect(asked).not.toContain('IMG_0412.MOV ·');

    const bundled = redactRunEvent(completed[0]!, { includeChatText: false, home: '/Users/me' }).event;
    expect(bundled.payload).toMatchObject({ summary: { redacted: 'text' } });
  });
});
