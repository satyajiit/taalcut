// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Chat persistence: the ConversationStore the chat backend uses (library port). */
import { join } from 'node:path';
import {
  ConflictError,
  NotFoundError,
  unwrap,
  ValidationError,
  type ConversationId,
  type ProjectId,
  type RunId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createLibraryPorts,
  createRepositories,
  InvalidState,
  openDatabase,
  scanForSecrets,
} from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';

function setup(path?: string) {
  const clock = fakeClock();
  const db = path
    ? unwrap(openDatabase({ path, clock: clock.now }))
    : openTestDb({ file: false, clock: clock.now });
  return { db, clock, store: createLibraryPorts(db).conversations, repos: createRepositories(db) };
}

const text = (t: string) => ({ type: 'text' as const, text: t });
const run = 'run-1' as RunId;

describe('ConversationStore', () => {
  it('lists conversations most recent first, with title and a preview of the last message', async () => {
    const { store, clock, repos } = setup();
    const project = unwrap(repos.projects.create({ name: 'Trip' }));
    const a = unwrap(await store.create({ title: '  Goa edit  ', projectId: project.id }));
    clock.advance(10);
    const b = unwrap(await store.create());
    clock.advance(10);
    unwrap(
      await store.appendMessage({
        conversationId: a.id,
        role: 'user',
        parts: [text('cut the\n  beach   shots')],
      }),
    );
    unwrap(
      await store.appendMessage({
        conversationId: a.id,
        role: 'system',
        parts: [text('system prompts are not previews')],
      }),
    );
    clock.advance(10);
    unwrap(
      await store.appendMessage({ conversationId: b.id, role: 'assistant', parts: [text('x'.repeat(300))] }),
    );
    const list = unwrap(await store.list());
    expect(list.map((c) => [c.id, c.title, c.preview.length])).toEqual([
      [b.id, '', 120],
      [a.id, 'Goa edit', 'cut the beach shots'.length],
    ]);
    expect(list[1]).toMatchObject({ preview: 'cut the beach shots', projectId: project.id, archived: false });
    expect(list[0]!.preview.endsWith('…')).toBe(true);
    expect(unwrap(await store.list({ projectId: project.id })).map((c) => c.id)).toEqual([a.id]);
    expect(unwrap(await store.list({ projectId: null })).map((c) => c.id)).toEqual([b.id]);
    expect(unwrap(await store.list({ limit: 1 }))).toHaveLength(1);
  });

  it('creates a conversation on its first message, and stores cards once, by reference', async () => {
    const { store, clock } = setup();
    const id = 'conv-new' as ConversationId;
    const plan = {
      type: 'plan',
      id: 'plan:run-1',
      version: 1,
      runId: run,
      steps: [{ id: 's1', text: 'Cut', status: 'running' }],
    };
    unwrap(
      await store.appendMessage({
        conversationId: id,
        role: 'user',
        parts: [text('make a reel')],
        runId: run,
      }),
    );
    unwrap(await store.putCard({ conversationId: id, runId: run, card: plan }));
    clock.advance(5);
    const done = { ...plan, steps: [{ id: 's1', text: 'Cut', status: 'done' }] };
    const reply = unwrap(
      await store.appendMessage({
        conversationId: id,
        role: 'assistant',
        runId: run,
        parts: [text('Done.'), { type: 'card', card: done }, { type: 'card', cardId: 'plan:run-1' }],
      }),
    );
    expect(reply.parts).toEqual([
      text('Done.'),
      { type: 'card', cardId: 'plan:run-1' },
      { type: 'card', cardId: 'plan:run-1' },
    ]);
    const record = unwrap(await store.get(id));
    expect(record.cards).toEqual([
      {
        cardId: 'plan:run-1',
        runId: run,
        card: done,
        createdAt: record.conversation.createdAt,
        updatedAt: clock.now(),
      },
    ]);
    expect(record.messages.map((m) => [m.role, m.runId])).toEqual([
      ['user', run],
      ['assistant', run],
    ]);
    const dangling = await store.appendMessage({
      conversationId: id,
      role: 'assistant',
      parts: [{ type: 'card', cardId: 'nope' }],
    });
    expect(!dangling.ok && NotFoundError.is(dangling.error)).toBe(true);
    for (const parts of [[{ type: 'image' }], [{ type: 'card', card: { id: '' } }], [{ type: 'text' }]]) {
      const bad = await store.appendMessage({ conversationId: id, role: 'user', parts: parts as never });
      expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
    }
    expect((await store.appendMessage({ conversationId: id, role: 'tool' as never, parts: [] })).ok).toBe(
      false,
    );
    expect((await store.putCard({ conversationId: id, card: { type: 'plan' } as never })).ok).toBe(false);
  });

  it('archives, deletes and restores softly, and purges for good', async () => {
    const { store, repos } = setup();
    const { id } = unwrap(await store.create({ title: 'Old' }));
    unwrap(await store.appendMessage({ conversationId: id, role: 'user', parts: [text('hi')] }));
    expect(unwrap(await store.rename(id, 'New')).title).toBe('New');
    expect(unwrap(await store.archive(id)).archived).toBe(true);
    expect(unwrap(await store.list())).toEqual([]);
    expect(unwrap(await store.list({ archived: true })).map((c) => c.id)).toEqual([id]);
    unwrap(await store.unarchive(id));
    unwrap(await store.delete(id));
    expect(unwrap(await store.list())).toEqual([]);
    const gone = await store.get(id);
    expect(!gone.ok && NotFoundError.is(gone.error)).toBe(true);
    const appendToDeleted = await store.appendMessage({
      conversationId: id,
      role: 'user',
      parts: [text('x')],
    });
    expect(!appendToDeleted.ok && InvalidState.is(appendToDeleted.error)).toBe(true);
    expect((await store.rename(id, 'x')).ok).toBe(false);
    expect(unwrap(await store.restore(id))).toMatchObject({ title: 'New', preview: 'hi' });
    expect(unwrap(await store.get(id)).messages).toHaveLength(1);
    unwrap(await store.purge(id));
    expect(repos.conversations.get(id).ok).toBe(false);
    expect((await store.archive('missing' as ConversationId)).ok).toBe(false);
  });

  it('links runs to the conversation before they log, and refuses a second conversation', async () => {
    const { store, repos } = setup();
    const a = unwrap(await store.create());
    const b = unwrap(await store.create());
    unwrap(await store.linkRun(a.id, run));
    unwrap(await store.linkRun(a.id, run));
    const elsewhere = await store.linkRun(b.id, run);
    expect(!elsewhere.ok && ConflictError.is(elsewhere.error)).toBe(true);
    // The run log's first append still works and keeps the link.
    unwrap(repos.runLog.append(run, [{ at: 1, type: 'run.started', data: {} }], { expectedSeq: 0 }));
    const other = 'run-2' as RunId;
    unwrap(repos.runLog.append(other, [{ at: 1, type: 'run.started', data: {} }], { expectedSeq: 0 }));
    unwrap(await store.linkRun(b.id, other));
    expect(unwrap(await store.get(a.id)).runs).toMatchObject([
      { runId: run, conversationId: a.id, lastSeq: 1 },
    ]);
    expect(unwrap(await store.get(b.id)).runs).toMatchObject([{ runId: other, conversationId: b.id }]);
  });

  it('moves a chat into the project its flow created, and out again', async () => {
    const { store, repos, clock } = setup();
    const chat = unwrap(await store.create({ title: 'Goa' }));
    const project = unwrap(repos.projects.create({ name: 'Goa trip' }));
    clock.advance(5);
    const moved = unwrap(await store.setProject(chat.id, project.id));
    expect(moved).toMatchObject({ id: chat.id, projectId: project.id });
    expect(moved.updatedAt).toBeGreaterThan(chat.updatedAt);
    expect(unwrap(await store.list({ projectId: project.id })).map((c) => c.id)).toEqual([chat.id]);
    expect(unwrap(await store.setProject(chat.id, null)).projectId).toBeNull();
    const unknown = await store.setProject(chat.id, 'missing' as ProjectId);
    expect(!unknown.ok && NotFoundError.is(unknown.error)).toBe(true);
    const missing = await store.setProject('missing' as ConversationId, project.id);
    expect(!missing.ok && NotFoundError.is(missing.error)).toBe(true);
  });

  it('stores no secrets from titles, message text or cards', async () => {
    const path = join(tempDir(), 'library.db');
    const { store, db } = setup(path);
    const key = `sk-proj-${'Zz9'.repeat(10)}`;
    const { id } = unwrap(await store.create({ title: `about ${key}` }));
    unwrap(
      await store.appendMessage({ conversationId: id, role: 'user', parts: [text(`my key is ${key}`)] }),
    );
    unwrap(
      await store.putCard({ conversationId: id, card: { type: 'error', id: 'e1', detail: `Bearer ${key}` } }),
    );
    unwrap(await store.rename(id, `renamed ${key}`));
    expect(scanForSecrets({ databasePath: path }).findings).toEqual([]);
    expect(unwrap(await store.get(id)).conversation.title).toBe('renamed [redacted:api_key]');
    db.close();
  });

  it('preserves updatedAt when rename is called with preserveUpdatedAt: true', () => {
    const { repos, clock } = setup();
    const created = unwrap(repos.chat.create({ title: 'Initial provisional' }));
    const initialUpdatedAt = created.updatedAt;
    clock.advance(50);

    const silentRename = unwrap(
      repos.chat.rename(created.id, 'AI Stage 1 Title', { preserveUpdatedAt: true }),
    );
    expect(silentRename.title).toBe('AI Stage 1 Title');
    expect(silentRename.updatedAt).toBe(initialUpdatedAt);

    clock.advance(50);
    const manualRename = unwrap(repos.chat.rename(created.id, 'User Manual Title'));
    expect(manualRename.title).toBe('User Manual Title');
    expect(manualRename.updatedAt).toBe(clock.now());
  });
});
