// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ChatServiceToken, EventBusToken, newId, unwrap, type EventOf } from '@taalcut/core';
import { createScriptedModelClient } from '@taalcut/agent';
import { expect, it } from 'vitest';
import { composeAgent } from '../src/utility/roots/agent-root';
import { fakeHardware, noLocalRuntime, SOUL, testConfig } from './helpers/roots';

it('forwards real live chat tool completions onto the global event bus, without replaying history', async () => {
  const model = createScriptedModelClient((_request, turn) =>
    turn === 0
      ? { toolCalls: [{ name: 'library_listSources', arguments: {} }] }
      : { text: 'No sources yet.' },
  );
  const root = composeAgent(testConfig('agent'), {
    soul: SOUL,
    hardware: fakeHardware,
    localRuntime: noLocalRuntime,
    modelClient: () => model,
  });
  const global: EventOf<'agent.toolFinished'>[] = [];
  const off = root.container.resolve(EventBusToken).on('agent.toolFinished', (event) => global.push(event));
  try {
    const chat = root.container.resolve(ChatServiceToken);
    const conversationId = newId<'Conversation'>();
    const sent = unwrap(
      await chat.send(
        { conversationId, text: 'List my library sources' },
        { signal: new AbortController().signal },
      ),
    );
    const live: EventOf<'agent.toolFinished'>[] = [];
    for await (const event of sent.events) if (event.type === 'agent.toolFinished') live.push(event);
    expect(live).toHaveLength(1);
    expect(live[0]?.payload).toMatchObject({ tool: 'library.listSources', status: 'succeeded' });
    expect(global.map(({ payload }) => payload)).toEqual(live.map(({ payload }) => payload));
    const history = unwrap(await chat.getConversation(conversationId)).history;
    expect(history.some((event) => event.type === 'agent.toolFinished')).toBe(true);
    expect(global).toHaveLength(1);
  } finally {
    off();
    await root.container.dispose();
  }
});
