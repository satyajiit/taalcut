// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: a batch of comments for one run. The agent reads the open ones a message sent, on the first one's
 * timeline and in its order, marks them sent to the run, and at the run's end gives back the ones still sent to it.
 */
import { newId, unwrap, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createCommentBatches } from '../../src/index';
import { agent, clips, itemTarget, N, person, setup, textItem } from './comment-setup';

async function batches() {
  const context = await setup();
  const port = createCommentBatches({ store: context.store, timelines: context.timelines, bus: context.bus });
  return { ...context, port };
}

describe('a batch of comments for one run', () => {
  it('reads the open comments, in the order sent, where each is now', async () => {
    const { port, add, timeline, bus, where } = await batches();
    const [, second] = clips(timeline);
    const one = await add({ anchor: itemTarget(timeline, second!.id), at: 5 });
    const two = await add({ body: 'Brighter', anchor: { kind: 'timeline', timelineId: timeline.id } });
    const done = await add({ body: 'Already done' });
    unwrap(
      await bus.dispatch(N.setStatus, { ...where, commentId: done.commentId, status: 'resolved' }, person),
    );
    const missing = newId<'TimelineComment'>();
    const batch = unwrap(await port.open([two.commentId, missing, done.commentId, one.commentId]));
    expect(batch).toEqual({
      projectId: where.projectId,
      timelineId: timeline.id,
      templateId: timeline.template!.id,
      revision: 1,
      rate: { num: 30, den: 1 },
      comments: [
        { commentId: two.commentId, on: 'timeline', start: 0, end: 150, body: 'Brighter' },
        {
          commentId: one.commentId,
          on: 'clip',
          itemId: second!.id,
          start: 60,
          end: 120,
          frame: 65,
          body: 'Make this half speed',
        },
      ],
    });
    expect(unwrap(await port.open([done.commentId, missing]))).toBeNull();
  });

  it('marks them sent to the run, then gives back only those still sent to it', async () => {
    const { port, add, get, bus, where, timeline, timelines } = await batches();
    const one = await add();
    const two = await add({ body: 'Shorter title', anchor: itemTarget(timeline, textOf(timeline), 'text') });
    const three = await add({ body: 'Louder' });
    const runId = newId<'AgentRun'>() as RunId;
    const batch = unwrap(await port.open([one.commentId, two.commentId, three.commentId]))!;
    unwrap(await port.send(batch, runId));
    expect((await get(one.commentId)).status).toBe('sent');
    expect((await get(two.commentId)).runId).toBe(runId);

    unwrap(
      await bus.dispatch(
        N.reply,
        { ...where, commentId: one.commentId, reply: 'Half speed now.', status: 'resolved', changeRefs: [] },
        agent,
      ),
    );
    // A person takes one back and sends it again in another run.
    unwrap(await bus.dispatch(N.setStatus, { ...where, commentId: three.commentId, status: 'open' }, person));
    const other = newId<'AgentRun'>() as RunId;
    unwrap(await port.send(unwrap(await port.open([three.commentId]))!, other));

    expect(unwrap(await port.release(batch, runId))).toBe(1);
    expect(await get(one.commentId)).toMatchObject({ status: 'resolved', reply: 'Half speed now.' });
    expect((await get(two.commentId)).status).toBe('open');
    expect(await get(three.commentId)).toMatchObject({ status: 'sent', runId: other });
    expect(unwrap(await port.release(batch, runId))).toBe(0);
    expect(timelines).toBeDefined();
  });

  it('keeps a batch to the first comment’s timeline', async () => {
    const { port, add, timeline } = await batches();
    const one = await add();
    const batch = unwrap(await port.open([one.commentId]))!;
    expect(batch.comments.map((c) => c.commentId)).toEqual([one.commentId]);
    expect(batch.timelineId).toBe(timeline.id);
    expect(textItem(0, 1).type).toBe('text');
  });
});

function textOf(timeline: Parameters<typeof clips>[0]): string {
  const text = timeline.tracks.find((track) => track.kind === 'text')!;
  return text.items[0]!.id;
}
