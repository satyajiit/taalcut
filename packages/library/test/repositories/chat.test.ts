// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { NotFoundError, unwrap, ValidationError, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, InvalidState } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  return { db, clock, repos: createRepositories(db) };
}

describe('ProjectRepository', () => {
  it('creates, lists, renames and removes projects', () => {
    const { repos, clock } = setup();
    const a = unwrap(repos.projects.create({ name: '  Goa trip ' }));
    clock.advance(10);
    const b = unwrap(repos.projects.create({ name: 'Wedding' }));
    expect(a.name).toBe('Goa trip');
    expect(repos.projects.list().map((p) => p.name)).toEqual(['Wedding', 'Goa trip']);

    clock.advance(10);
    const renamed = unwrap(repos.projects.rename(a.id, 'Goa 2026'));
    expect(renamed).toMatchObject({ name: 'Goa 2026', updatedAt: clock.now(), createdAt: a.createdAt });
    expect(repos.projects.list()[0]?.id).toBe(a.id);

    unwrap(repos.projects.remove(b.id));
    const gone = repos.projects.get(b.id);
    expect(!gone.ok && NotFoundError.is(gone.error)).toBe(true);
  });

  it('rejects empty names and unknown ids', () => {
    const { repos } = setup();
    const empty = repos.projects.create({ name: '   ' });
    expect(!empty.ok && ValidationError.is(empty.error)).toBe(true);
    const missing = repos.projects.rename('01J00000000000000000000000' as never, 'x');
    expect(!missing.ok && NotFoundError.is(missing.error)).toBe(true);
    const gone = repos.projects.remove('01J00000000000000000000000' as never);
    expect(!gone.ok && NotFoundError.is(gone.error)).toBe(true);
  });
});

describe('ConversationRepository', () => {
  it('appends messages in order and bumps the conversation', () => {
    const { repos, clock } = setup();
    const project = unwrap(repos.projects.create({ name: 'P' }));
    const chat = unwrap(repos.conversations.create({ projectId: project.id, title: 'First' }));
    clock.advance(5);
    const m1 = unwrap(
      repos.conversations.appendMessage({ conversationId: chat.id, role: 'user', content: [{ text: 'hi' }] }),
    );
    const m2 = unwrap(
      repos.conversations.appendMessage({
        conversationId: chat.id,
        role: 'assistant',
        content: { parts: [] },
        runId: 'run-1' as RunId,
      }),
    );
    expect(repos.conversations.listMessages(chat.id).map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(repos.conversations.listMessages(chat.id, { afterId: m1.id }).map((m) => m.content)).toEqual([
      { parts: [] },
    ]);
    expect(unwrap(repos.conversations.get(chat.id)).updatedAt).toBe(clock.now());
  });

  it('lists by project or outside any project, newest first', () => {
    const { repos, clock } = setup();
    const project = unwrap(repos.projects.create({ name: 'P' }));
    const loose = unwrap(repos.conversations.create({}));
    clock.advance(1);
    const a = unwrap(repos.conversations.create({ projectId: project.id }));
    clock.advance(1);
    const b = unwrap(repos.conversations.create({ projectId: project.id }));
    expect(repos.conversations.listByProject(project.id).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(repos.conversations.listByProject(null).map((c) => c.id)).toEqual([loose.id]);
    clock.advance(1);
    unwrap(repos.conversations.setTitle(a.id, 'Renamed'));
    expect(repos.conversations.listByProject(project.id)[0]?.title).toBe('Renamed');
  });

  it('fails to append to a missing conversation and cascades on delete', () => {
    const { repos } = setup();
    const result = repos.conversations.appendMessage({
      conversationId: 'nope' as never,
      role: 'user',
      content: 'x',
    });
    expect(!result.ok && NotFoundError.is(result.error)).toBe(true);

    const project = unwrap(repos.projects.create({ name: 'P' }));
    const chat = unwrap(repos.conversations.create({ projectId: project.id }));
    unwrap(repos.conversations.appendMessage({ conversationId: chat.id, role: 'user', content: 'x' }));
    unwrap(repos.projects.remove(project.id));
    expect(repos.conversations.get(chat.id).ok).toBe(false);
    expect(repos.conversations.listMessages(chat.id)).toEqual([]);
  });
});

describe('ToolRunRepository', () => {
  it('starts and finishes a run once', () => {
    const { repos, clock } = setup();
    const run = 'run-1' as RunId;
    const started = unwrap(
      repos.toolRuns.start({
        runId: run,
        toolName: 'media.probe',
        toolVersion: '1',
        input: { path: '/a.mov' },
      }),
    );
    expect(started.status).toBe('running');
    clock.advance(250);
    const done = unwrap(repos.toolRuns.finish(started.id, { status: 'succeeded', output: { duration: 3 } }));
    expect(done).toMatchObject({ status: 'succeeded', output: { duration: 3 }, finishedAt: clock.now() });
    const again = repos.toolRuns.finish(started.id, { status: 'failed' });
    expect(!again.ok && InvalidState.is(again.error)).toBe(true);
    expect(repos.toolRuns.listByRun(run).map((r) => r.id)).toEqual([started.id]);
  });

  it('lists runs in a conversation, newest first', () => {
    const { repos, clock } = setup();
    const chat = unwrap(repos.conversations.create({}));
    const a = unwrap(
      repos.toolRuns.start({ conversationId: chat.id, toolName: 'a', toolVersion: '1', input: {} }),
    );
    clock.advance(1);
    const b = unwrap(
      repos.toolRuns.start({ conversationId: chat.id, toolName: 'b', toolVersion: '1', input: {} }),
    );
    expect(repos.toolRuns.listByConversation(chat.id).map((r) => r.id)).toEqual([b.id, a.id]);
  });
});
