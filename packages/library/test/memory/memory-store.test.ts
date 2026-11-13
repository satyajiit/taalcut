// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM: the memory store. Items round-trip through core's schema, revisions conflict, a scope must name a
 * project or template that exists, lists filter by scope, kind, source and data kind and join the scope's name,
 * a query ranks by words (prefixes, any script), deleting a project or template takes its items and their search
 * rows with it, and items survive closing and reopening the database (a restart).
 */
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryStore, createRepositories, memoryScopeName, openDatabase } from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { memoryItem, scopes } from './memory-setup';

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

describe('memory store (LRN1-MEM)', () => {
  it('creates, reads back, replaces only the revision it names, and removes', async () => {
    const store = createMemoryStore(openTestDb({ file: false }));
    const item = memoryItem();
    expect(unwrap(await store.create(item))).toEqual(item);
    expect(code(await store.create(item))).toBe('core.conflict');
    expect(unwrap(await store.get(item.id))).toEqual(item);
    const edited = { ...item, text: 'No whip pans, ever.', revision: 2, updatedAt: item.updatedAt + 1 };
    expect(code(await store.put(edited, 2))).toBe('core.conflict');
    unwrap(await store.put(edited, 1));
    expect(unwrap(await store.get(item.id))).toMatchObject({ text: 'No whip pans, ever.', revision: 2 });
    expect(code(await store.put({ ...edited, text: ' ' }, 2))).toBe('core.validation');
    unwrap(await store.remove(item.id));
    expect(code(await store.get(item.id))).toBe('core.not_found');
    expect(code(await store.remove(item.id))).toBe('core.not_found');
    expect(code(await store.put(edited, 2))).toBe('core.not_found');
  });

  it('refuses a scope whose project or template is missing, and data on an item that is not learned', async () => {
    const store = createMemoryStore(openTestDb({ file: false }));
    const lostProject = memoryItem({ scope: { kind: 'project', projectId: newId<'Project'>() } });
    expect(await store.create(lostProject)).toMatchObject({
      ok: false,
      error: { params: { entity: 'project' } },
    });
    const lostTemplate = memoryItem({ scope: { kind: 'template', templateId: newId<'Template'>() } });
    expect(await store.create(lostTemplate)).toMatchObject({
      ok: false,
      error: { params: { entity: 'template' } },
    });
    const weights = { intent: 1, motion: 1, quality: 1, subject: 1, energy: 1 };
    const data = {
      kind: 'casting-weights' as const,
      configVersion: 'casting.v1',
      defaults: weights,
      weights,
      pairs: 3,
    };
    expect(code(await store.create(memoryItem({ data })))).toBe('core.validation');
    unwrap(await store.create(memoryItem({ source: 'learned', data })));
  });

  it('lists newest first by scope, scope kind, source and data kind, with the scope name', async () => {
    const db = openTestDb({ file: false });
    const store = createMemoryStore(db);
    const { project, template, templateId } = await scopes(db);
    const user = memoryItem({ text: 'Captions in bold yellow.' });
    const decision = memoryItem({ scope: project, text: 'Open on the drone shot.', source: 'agent' });
    const worked = memoryItem({
      scope: template,
      text: 'Sunset montage reached export.',
      source: 'learned',
      data: {
        kind: 'what-worked',
        templateVersion: 1,
        styleId: null,
        presetId: 'reels',
        renderId: newId<'Render'>(),
        exports: 1,
      },
    });
    for (const item of [user, decision, worked]) unwrap(await store.create(item));
    const texts = async (filter: Parameters<typeof store.list>[0]) =>
      unwrap(await store.list(filter)).map((item) => item.text);
    expect(await texts({})).toEqual([worked.text, decision.text, user.text]);
    expect(await texts({ scopes: [{ kind: 'user' }, project] })).toEqual([decision.text, user.text]);
    expect(await texts({ scopes: [] })).toEqual([]);
    expect(await texts({ kinds: ['template', 'user'] })).toEqual([worked.text, user.text]);
    expect(await texts({ kinds: [] })).toEqual([]);
    expect(await texts({ sources: ['agent'] })).toEqual([decision.text]);
    expect(await texts({ dataKind: 'what-worked', scopes: [{ kind: 'template', templateId }] })).toEqual([
      worked.text,
    ]);
    expect(await texts({ limit: 1 })).toEqual([worked.text]);
    const names = unwrap(await store.list({})).map((item) => item.scopeName);
    expect(names).toEqual(['Sunset montage', 'Goa trip', null]);
    // The same names before an item exists (memory.remember's card says where it would apply).
    expect(
      [{ kind: 'user' } as const, project, template].map((scope) => unwrap(memoryScopeName(db, scope))),
    ).toEqual([null, 'Goa trip', 'Sunset montage']);
    const lost = memoryScopeName(db, { kind: 'project', projectId: newId<'Project'>() });
    expect(lost).toMatchObject({
      ok: false,
      error: { code: 'core.not_found', params: { entity: 'project' } },
    });
    expect(unwrap(await store.count({ kinds: ['user', 'project'] }))).toBe(2);
    expect(unwrap(await store.count({ sources: ['learned'] }))).toBe(1);
  });

  it('finds words as prefixes, best match first, in any script, and never parses the query as FTS syntax', async () => {
    const store = createMemoryStore(openTestDb({ file: false }));
    const whip = memoryItem({ text: 'Never use whip transitions.' });
    const both = memoryItem({ text: 'Whip pans only on the beat drop, never whip zooms.' });
    const hindi = memoryItem({ text: 'कैप्शन हमेशा हिंदी में रखें' });
    for (const item of [whip, both, hindi]) unwrap(await store.create(item));
    const found = async (query: string) => unwrap(await store.list({ query })).map((item) => item.id);
    expect(await found('whi')).toEqual(expect.arrayContaining([whip.id, both.id]));
    expect((await found('whip zoom'))[0]).toBe(both.id);
    expect(await found('हिंदी')).toEqual([hindi.id]);
    expect(await found('"whip" OR NEAR(')).toEqual(expect.arrayContaining([whip.id, both.id]));
    expect(await found('zebra')).toEqual([]);
    expect(await found('   ')).toEqual([]);
  });

  it('keeps the search rows in step with edits and with deletions a project or template cascades', async () => {
    const db = openTestDb({ file: false });
    const store = createMemoryStore(db);
    const { project, projectId } = await scopes(db);
    const decision = memoryItem({ scope: project, text: 'Keep the drone opener.' });
    unwrap(await store.create(decision));
    unwrap(await store.put({ ...decision, text: 'Keep the sunset opener.', revision: 2 }, 1));
    expect(unwrap(await store.list({ query: 'drone' }))).toEqual([]);
    expect(unwrap(await store.list({ query: 'sunset' })).map((item) => item.id)).toEqual([decision.id]);
    db.driver.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    expect(code(await store.get(decision.id))).toBe('core.not_found');
    expect(db.driver.prepare('SELECT count(*) AS n FROM memory_fts').get()).toEqual({ n: 0 });
  });

  it('keeps items across closing and reopening the database', async () => {
    const path = join(tempDir(), 'library.db');
    const first = unwrap(openDatabase({ path }));
    const item = memoryItem({ text: 'Always add captions.' });
    unwrap(await createMemoryStore(first).create(item));
    first.close();
    const again = unwrap(openDatabase({ path }));
    try {
      expect(unwrap(await createMemoryStore(again).get(item.id))).toEqual(item);
      expect(createRepositories(again).projects).toBeDefined();
    } finally {
      again.close();
    }
  });
});
