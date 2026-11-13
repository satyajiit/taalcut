// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor dock's new chat joins its project: the first message's clip
 * chips name a timeline, and the chat moves into that timeline's project.
 */
import { describe, expect, it } from 'vitest';
import {
  ConversationStoreToken,
  createContainer,
  createEventBus,
  EventBusToken,
  newId,
  NotFoundError,
  err,
  ok,
  systemClock,
  TimelineStoreToken,
  type ConversationStore,
  type TimelineStore,
} from '@taalcut/core';
import { chatProjectLink } from '../src/utility/roots/agent-flows';

function world() {
  const projectId = newId<'Project'>();
  const timelineId = newId<'Timeline'>();
  const moves: unknown[] = [];
  const changes: unknown[] = [];
  const container = createContainer();
  const timelines: Pick<TimelineStore, 'get'> = {
    get: async (id) =>
      id === timelineId
        ? ok({ summary: { projectId } as never, schemaVersion: 1, json: {} })
        : err(NotFoundError({ entity: 'timeline', id })),
  };
  const conversations: Pick<ConversationStore, 'setProject'> = {
    setProject: async (id, project) => {
      moves.push([id, project]);
      return ok({} as never);
    },
  };
  const events = createEventBus({ clock: systemClock });
  events.on('library.changed', (event) => changes.push(event.payload));
  container.value(TimelineStoreToken, timelines as TimelineStore);
  container.value(ConversationStoreToken, conversations as ConversationStore);
  container.value(EventBusToken, events);
  return { link: chatProjectLink(container), projectId, timelineId, moves, changes };
}

describe('chatProjectLink', () => {
  it('moves the chat into the project of the timeline its chips name, and says it changed', async () => {
    const w = world();
    const conversationId = newId<'Conversation'>();
    const chips = [
      { kind: 'slot' as const, templateId: newId<'Template'>(), slotId: newId<'TemplateSlot'>() },
      { kind: 'clip' as const, timelineId: w.timelineId, clipId: newId<'TimelineItem'>() },
    ];
    expect(await w.link(conversationId, chips)).toBe(w.projectId);
    expect(w.moves).toEqual([[conversationId, w.projectId]]);
    expect(w.changes).toEqual([
      { projectId: w.projectId, entity: 'conversation', change: 'updated', ids: [conversationId] },
    ]);
  });

  it('links nothing for chips without a timeline, or a timeline it cannot read', async () => {
    const w = world();
    const conversationId = newId<'Conversation'>();
    const slot = { kind: 'slot' as const, templateId: newId<'Template'>(), slotId: newId<'TemplateSlot'>() };
    expect(await w.link(conversationId, [slot])).toBeNull();
    const gone = { kind: 'clip' as const, timelineId: newId<'Timeline'>(), clipId: newId<'TimelineItem'>() };
    expect(await w.link(conversationId, [gone])).toBeNull();
    expect(w.moves).toEqual([]);
  });
});
