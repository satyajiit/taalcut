// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A ConversationStore in memory, for tests. The app uses library's (createLibraryPorts(db).conversations). */
import { err, newId, NotFoundError, ok, type ConversationId, type RunId } from '@taalcut/core';
import type { ConversationStore, ConversationSummary, StoredMessage } from './ports';

interface Entry {
  summary: ConversationSummary;
  messages: StoredMessage[];
  runs: { runId: RunId }[];
}

export function createMemoryConversationStore(now: () => number = Date.now): ConversationStore {
  const conversations = new Map<ConversationId, Entry>();
  const touch = (entry: Entry, at: number) => {
    entry.summary = { ...entry.summary, updatedAt: Math.max(entry.summary.updatedAt, at) };
  };
  const ensure = (id: ConversationId, title: string): Entry => {
    const existing = conversations.get(id);
    if (existing) return existing;
    const at = now();
    const entry = { summary: { id, title, createdAt: at, updatedAt: at }, messages: [], runs: [] };
    conversations.set(id, entry);
    return entry;
  };

  return {
    async create({ id, title }) {
      return ok(ensure(id ?? newId<'Conversation'>(), title ?? '').summary);
    },
    async list() {
      return ok([...conversations.values()].map((e) => e.summary).sort((a, b) => b.updatedAt - a.updatedAt));
    },
    async get(id) {
      const entry = conversations.get(id);
      if (!entry) return err(NotFoundError({ entity: 'conversation', id }));
      return ok({ conversation: entry.summary, messages: [...entry.messages], runs: [...entry.runs] });
    },
    async appendMessage({ conversationId, role, parts, runId, id }) {
      const entry = ensure(conversationId, '');
      const message: StoredMessage = {
        id: id ?? newId<'Message'>(),
        role,
        parts,
        runId: runId ?? null,
        createdAt: now(),
      };
      const existing = entry.messages.find((m) => m.id === message.id);
      if (existing) return ok(existing);
      entry.messages.push(message);
      touch(entry, message.createdAt);
      return ok(message);
    },
    async rename(id, title) {
      const entry = conversations.get(id);
      if (!entry) return err(NotFoundError({ entity: 'conversation', id }));
      entry.summary = { ...entry.summary, title: title.trim() };
      touch(entry, now());
      return ok(entry.summary);
    },
    async linkRun(conversationId, runId) {
      const entry = conversations.get(conversationId);
      if (!entry) return err(NotFoundError({ entity: 'conversation', id: conversationId }));
      if (!entry.runs.some((r) => r.runId === runId)) entry.runs.push({ runId });
      touch(entry, now());
      return ok(undefined);
    },
  };
}
