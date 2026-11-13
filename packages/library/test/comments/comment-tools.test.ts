// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: the `comments` tools and the comments namespace's service. comments.list shows a timeline's open and sent
 * comments flat, where each one is now; comments.reply answers one through the bus as the agent, its change refs on
 * the comment's timeline; the watch yields the list now and again after each change, and nothing in between.
 */
import {
  COMMENT_TOOLS,
  createEventBus,
  forwardCommandEvents,
  newId,
  unwrap,
  type AnyTool,
  type CommentsListToolOutput,
  type TimelineComment,
  type ToolContext,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { commentToolModule, createCommentsService } from '../../src/index';
import { agent, clips, itemTarget, N, person, setup } from './comment-setup';

function unreachable(): never {
  throw new Error('not used');
}

async function tools() {
  const context = await setup();
  const module = commentToolModule({ store: context.store, timelines: context.timelines });
  const tool = (name: string) => module.tools.find((t) => t.name === name)! as AnyTool;
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: { put: async () => unreachable(), get: async () => unreachable() },
    reportUsage: () => {},
    reportProgress: () => {},
    dispatch: (payload: unknown) => context.bus.dispatch(N.reply, payload, agent),
  } as unknown as ToolContext;
  return { ...context, module, tool, ctx };
}

describe('the comments tools (EDT1-CMT)', () => {
  it('are their own family', async () => {
    const { module } = await tools();
    expect(module.id).toBe('comments');
    expect(module.tools.map((t) => t.name)).toEqual([COMMENT_TOOLS.list, COMMENT_TOOLS.reply]);
  });

  it('list the open and sent comments flat, where each is now', async () => {
    const { tool, ctx, add, timeline, bus, where } = await tools();
    const [first, second] = clips(timeline);
    const one = await add({ anchor: itemTarget(timeline, second!.id), at: 12 });
    const two = await add({ body: 'Warmer', anchor: { kind: 'timeline', timelineId: timeline.id } });
    const done = await add({ body: 'Done already' });
    unwrap(
      await bus.dispatch(N.setStatus, { ...where, commentId: done.commentId, status: 'resolved' }, person),
    );
    const list = tool(COMMENT_TOOLS.list);
    const read = unwrap(
      await list.run(list.input.parse({ timelineId: timeline.id }), ctx),
    ) as CommentsListToolOutput;
    expect(read).toMatchObject({ timelineId: timeline.id, revision: 1, rate: { num: 30, den: 1 } });
    expect(read.comments).toEqual([
      {
        commentId: one.commentId,
        status: 'open',
        on: 'clip',
        itemId: second!.id,
        start: 60,
        end: 120,
        frame: 72,
        body: 'Make this half speed',
      },
      { commentId: two.commentId, status: 'open', on: 'timeline', start: 0, end: 150, body: 'Warmer' },
    ]);
    expect(first).toBeDefined();
  });

  it('reply in one line, as the agent, with what changed on that timeline', async () => {
    const { tool, ctx, add, get, timeline } = await tools();
    const [first] = clips(timeline);
    const { commentId } = await add();
    const reply = tool(COMMENT_TOOLS.reply);
    const input = reply.input.parse({
      commentId,
      reply: 'Clip 1 plays\nat half speed now.',
      status: 'resolved',
      changed: [first!.id, newId<'TimelineItem'>()],
    });
    expect(unwrap(await reply.run(input, ctx))).toEqual({ commentId, status: 'resolved' });
    const answered: TimelineComment = await get(commentId);
    expect(answered).toMatchObject({ status: 'resolved', reply: 'Clip 1 plays at half speed now.' });
    expect(answered.changeRefs).toEqual([{ target: itemTarget(timeline, first!.id), revision: 1 }]);
  });
});

describe('the comments namespace’s service', () => {
  it('watches a timeline’s comments: now, then after each change', async () => {
    const context = await setup();
    const events = createEventBus({ clock: { now: () => 1 } });
    forwardCommandEvents(context.bus, events);
    const service = createCommentsService({ store: context.store, timelines: context.timelines, events });
    const stop = new AbortController();
    const seen = service.watch(context.timeline.id, stop.signal)[Symbol.asyncIterator]();
    expect((await seen.next()).value).toEqual([]);
    const { commentId } = await context.add();
    expect(((await seen.next()).value as TimelineComment[]).map((c) => c.id)).toEqual([commentId]);
    unwrap(await context.bus.dispatch(N.remove, { ...context.where, commentId }, person));
    expect((await seen.next()).value).toEqual([]);
    stop.abort();
    expect((await seen.next()).done).toBe(true);
    expect(unwrap(await service.list({ timelineId: context.timeline.id }))).toEqual([]);
  });

  it('ends a watch of a timeline that isn’t there', async () => {
    const context = await setup();
    const events = createEventBus({ clock: { now: () => 1 } });
    const service = createCommentsService({ store: context.store, timelines: context.timelines, events });
    const seen = service.watch(newId<'Timeline'>(), new AbortController().signal)[Symbol.asyncIterator]();
    await expect(seen.next()).rejects.toMatchObject({ code: 'core.not_found' });
  });
});
