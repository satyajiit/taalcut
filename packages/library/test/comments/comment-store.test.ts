// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-CMT: the comment store over migration 39: rows round-trip through core's schema, oldest first, filtered. */
import { newId, unwrap, type TimelineComment } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { timelineComments } from '../../src/index';
import { clips, itemTarget, setup } from './comment-setup';

describe('the comment store (EDT1-CMT)', () => {
  async function stored() {
    const context = await setup();
    const { store, timeline } = context;
    let at = 10;
    const make = (overrides: Partial<TimelineComment> = {}): TimelineComment => ({
      id: newId<'TimelineComment'>(),
      projectId: timeline.projectId,
      timelineId: timeline.id,
      anchor: itemTarget(timeline, clips(timeline)[0]!.id),
      body: 'Tighter',
      author: 'user',
      status: 'open',
      createdAt: (at += 1),
      updatedAt: at,
      ...overrides,
    });
    const first = unwrap(await store.create(make()));
    const second = unwrap(
      await store.create(make({ status: 'resolved', reply: 'Trimmed a beat.', runId: newId<'AgentRun'>() })),
    );
    return { ...context, make, first, second };
  }

  it('round-trips a comment and lists a timeline’s oldest first, by status or id', async () => {
    const { store, timeline, first, second } = await stored();
    expect(unwrap(await store.get(second.id))).toEqual(second);
    expect(unwrap(await store.list(timeline.id)).map((c) => c.id)).toEqual([first.id, second.id]);
    expect(unwrap(await store.list(timeline.id, { statuses: ['open'] })).map((c) => c.id)).toEqual([
      first.id,
    ]);
    expect(unwrap(await store.list(timeline.id, { statuses: [] }))).toEqual([]);
    expect(unwrap(await store.list(timeline.id, { ids: [second.id] })).map((c) => c.id)).toEqual([second.id]);
    expect(unwrap(await store.listByProject(timeline.projectId, { statuses: ['resolved'] }))).toHaveLength(1);
    expect(unwrap(await store.count(timeline.id))).toBe(2);
  });

  it('refuses a second comment with the same id, one on a missing timeline, and a bad one', async () => {
    const { store, make, first } = await stored();
    expect((await store.create(first)).ok).toBe(false);
    const elsewhere = newId<'Timeline'>();
    const lost = make({ timelineId: elsewhere, anchor: { kind: 'timeline', timelineId: elsewhere } });
    const missing = await store.create(lost);
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
    const bad = await store.create(make({ body: '' }));
    expect(!bad.ok && bad.error.code).toBe('core.validation');
  });

  it('replaces and removes; a gone comment is not found', async () => {
    const { store, first } = await stored();
    unwrap(await store.put({ ...first, body: 'Much tighter' }));
    expect(unwrap(await store.get(first.id)).body).toBe('Much tighter');
    unwrap(await store.remove(first.id));
    const gone = await store.get(first.id);
    expect(!gone.ok && gone.error.code).toBe('core.not_found');
    expect((await store.put(first)).ok).toBe(false);
  });

  it('goes with its timeline', async () => {
    const { db, timelines, timeline, store } = await stored();
    unwrap(await timelines.remove(timeline.id));
    expect(unwrap(await store.list(timeline.id))).toEqual([]);
    expect(db.orm.select().from(timelineComments).all()).toEqual([]);
  });
});
