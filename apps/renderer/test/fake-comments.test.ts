// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: the preview's comments (backend/fake/comments) answer as the library does. The page adds, edits and removes
 * a comment through `commands`, ⌘Z undoes each; the watch yields after each change; the agent sends and answers, and
 * may not edit a person's words; the seeded scenario puts one open, one done and one on the whole video.
 */
import { callRpc, COMMENT_COMMANDS as N, newId, type Clip, type TimelineComment } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;
const where = { projectId, timelineId };

function setup(scenario?: 'seeded') {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    ...(scenario ? { phase3: { comments: { scenario } } } : {}),
  });
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:run' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const list = () => client.comments.list({ timelineId });
  const clip = async (n: number) => {
    const timeline = await client.timelines.get({ timelineId });
    const found = timeline.tracks[0]!.items.filter((item): item is Clip => item.type === 'clip')[n]!;
    return { kind: 'item', timelineId, itemId: found.id, itemKind: 'clip' } as const;
  };
  return { client, dispatch, undo, list, clip };
}

describe('the preview’s comments (EDT1-CMT)', () => {
  it('adds, edits and removes from the page; ⌘Z undoes each', async () => {
    const { dispatch, undo, list, clip } = setup();
    const commentId = newId<'TimelineComment'>();
    const anchor = await clip(1);
    expect((await dispatch(N.add, { ...where, commentId, anchor, body: 'Half speed' })).ok).toBe(true);
    expect(await list()).toMatchObject([
      { id: commentId, anchor, body: 'Half speed', status: 'open', author: 'user' },
    ]);
    expect((await dispatch(N.edit, { ...where, commentId, patch: { body: 'Quarter speed' } })).ok).toBe(true);
    expect((await list())[0]!.body).toBe('Quarter speed');
    expect((await dispatch(N.remove, { ...where, commentId })).ok).toBe(true);
    expect(await list()).toEqual([]);
    expect((await undo()).ok).toBe(true);
    expect((await list())[0]!.body).toBe('Quarter speed');
    expect((await undo()).ok).toBe(true);
    expect((await list())[0]!.body).toBe('Half speed');
    expect((await undo()).ok).toBe(true);
    expect(await list()).toEqual([]);
  });

  it('refuses an anchor that isn’t on the video', async () => {
    const { dispatch, list } = setup();
    const anchor = { kind: 'item', timelineId, itemId: newId<'TimelineItem'>(), itemKind: 'clip' } as const;
    const result = await dispatch(N.add, {
      ...where,
      commentId: newId<'TimelineComment'>(),
      anchor,
      body: 'Hm',
    });
    expect(result.ok ? null : result.error.code).toBe('core.comment_target_gone');
    expect(await list()).toEqual([]);
  });

  it('the agent sends and answers; it may not rewrite a person’s words; the watch sees each change', async () => {
    const { client, dispatch, list, clip } = setup();
    const stop = new AbortController();
    const seen = (await client.comments.watch({ timelineId }, { signal: stop.signal }))[
      Symbol.asyncIterator
    ]();
    expect((await seen.next()).value).toEqual([]);
    const commentId = newId<'TimelineComment'>();
    await dispatch(N.add, { ...where, commentId, anchor: await clip(0), body: 'Warmer' });
    expect(((await seen.next()).value as TimelineComment[]).map((c) => c.status)).toEqual(['open']);
    const runId = newId<'Run'>();
    expect((await dispatch(N.send, { ...where, commentIds: [commentId], runId }, 'agent')).ok).toBe(true);
    expect(((await seen.next()).value as TimelineComment[])[0]).toMatchObject({ status: 'sent', runId });
    const edit = await dispatch(N.edit, { ...where, commentId, patch: { body: 'Cooler' } }, 'agent');
    expect(edit.ok ? null : edit.error.code).toBe('core.comment_not_yours');
    const reply = { ...where, commentId, reply: 'Clip 1 is warmer now.', status: 'resolved', changeRefs: [] };
    expect((await dispatch(N.reply, reply, 'agent')).ok).toBe(true);
    expect((await list())[0]).toMatchObject({
      status: 'resolved',
      reply: 'Clip 1 is warmer now.',
      body: 'Warmer',
    });
    stop.abort();
  });

  it('seeds one open comment on clip 1, one done on clip 2 and one on the whole video', async () => {
    const { list } = setup('seeded');
    const comments = await list();
    expect(comments.map((c) => [c.anchor.kind, c.status, c.reply ?? null])).toEqual([
      ['item', 'open', null],
      ['item', 'resolved', 'Clip 2 is a beat shorter now.'],
      ['timeline', 'open', null],
    ]);
  });
});
