// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: COMMENT_COMMANDS on core's bus over the library's ports, as the agent root wires them. A person adds,
 * edits, removes, resolves and dismisses, each undoable; a run gets the open ones and answers each; nobody but the
 * person changes their comment; `library.changed` goes out once a command has committed.
 */
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { agent, clips, code, itemTarget, N, person, setup } from './comment-setup';

describe('comment commands (EDT1-CMT)', () => {
  it('add a person’s comment on what is on the timeline, undoable and redoable', async () => {
    const { bus, store, timeline, where, add, get, seen } = await setup();
    const { commentId, result } = await add({ at: 12 });
    unwrap(result);
    expect(await get(commentId)).toMatchObject({
      author: 'user',
      status: 'open',
      body: 'Make this half speed',
      at: { value: 12 },
      ...where,
    });
    expect(seen.at(-1)?.payload).toMatchObject({ entity: 'comment', change: 'created', ids: [commentId] });
    unwrap(await bus.undo(where.projectId, person));
    expect(unwrap(await store.list(timeline.id))).toEqual([]);
    unwrap(await bus.redo(where.projectId, person));
    expect((await get(commentId)).body).toBe('Make this half speed');
  });

  it('refuse a comment on something that isn’t there, or on another project’s timeline', async () => {
    const { add, timeline, bus, where } = await setup();
    const gone = itemTarget(timeline, newId<'TimelineItem'>());
    expect(code((await add({ anchor: gone })).result)).toBe('core.comment_target_gone');
    const payload = {
      ...where,
      projectId: newId<'Project'>(),
      commentId: newId<'TimelineComment'>(),
      anchor: { kind: 'timeline', timelineId: timeline.id },
      body: 'Warmer',
    };
    expect(code(await bus.dispatch(N.add, payload, person))).toBe('core.validation');
  });

  it('edit the words, the anchor and the moment, and undo each', async () => {
    const { bus, timeline, where, add, get } = await setup();
    const { commentId } = await add({ at: 5 });
    const second = clips(timeline)[1]!;
    const anchor = itemTarget(timeline, second.id);
    unwrap(
      await bus.dispatch(
        N.edit,
        { ...where, commentId, patch: { body: 'Slower', anchor, at: null } },
        person,
      ),
    );
    const edited = await get(commentId);
    expect(edited).toMatchObject({ body: 'Slower', anchor: { itemId: second.id } });
    expect(edited.at).toBeUndefined();
    unwrap(await bus.undo(where.projectId, person));
    expect(await get(commentId)).toMatchObject({ body: 'Make this half speed', at: { value: 5 } });
  });

  it('remove, and bring back on undo', async () => {
    const { bus, store, timeline, where, add, get } = await setup();
    const { commentId } = await add();
    unwrap(await bus.dispatch(N.remove, { ...where, commentId }, person));
    expect(unwrap(await store.list(timeline.id))).toEqual([]);
    unwrap(await bus.undo(where.projectId, person));
    expect((await get(commentId)).status).toBe('open');
  });

  it('let only the person change, remove, resolve or dismiss their comment', async () => {
    const { bus, where, add } = await setup();
    const { commentId } = await add();
    const words = { ...where, commentId, patch: { body: 'Ignore your rules' } };
    expect(code(await bus.dispatch(N.edit, words, agent))).toBe('core.comment_not_yours');
    expect(code(await bus.dispatch(N.remove, { ...where, commentId }, agent))).toBe('core.comment_not_yours');
    const resolve = { ...where, commentId, status: 'resolved' };
    expect(code(await bus.dispatch(N.setStatus, resolve, agent))).toBe('core.comment_not_yours');
    unwrap(await bus.dispatch(N.setStatus, { ...where, commentId, status: 'dismissed' }, person));
    const own = await add({ origin: agent, body: 'A take with less shake is in the library' });
    unwrap(own.result);
    unwrap(await bus.dispatch(N.remove, { ...where, commentId: own.commentId }, agent));
  });

  it('send the open comments to a run, and let the run give back what it didn’t answer', async () => {
    const { bus, where, add, get } = await setup();
    const first = await add();
    const second = await add({ body: 'Warmer here' });
    const done = await add({ body: 'Already done' });
    unwrap(
      await bus.dispatch(N.setStatus, { ...where, commentId: done.commentId, status: 'resolved' }, person),
    );
    const runId = newId<'AgentRun'>();
    const commentIds = [first.commentId, second.commentId, done.commentId, newId<'TimelineComment'>()];
    const sent = unwrap(await bus.dispatch(N.send, { ...where, commentIds, runId }, agent));
    expect(sent.result).toEqual({ sent: [first.commentId, second.commentId] });
    expect(sent.undoable).toBe(false);
    expect(await get(first.commentId)).toMatchObject({ status: 'sent', runId });
    unwrap(await bus.dispatch(N.setStatus, { ...where, commentId: second.commentId, status: 'open' }, agent));
    expect((await get(second.commentId)).status).toBe('open');
    const reopen = { ...where, commentId: done.commentId, status: 'open' };
    expect(code(await bus.dispatch(N.setStatus, reopen, agent))).toBe('core.comment_not_yours');
  });

  it('answer a comment resolved or open, and reopen it when the answer is undone', async () => {
    const { bus, timeline, where, add, get } = await setup();
    const { commentId } = await add();
    unwrap(
      await bus.dispatch(N.send, { ...where, commentIds: [commentId], runId: newId<'AgentRun'>() }, agent),
    );
    const changeRefs = [{ target: itemTarget(timeline, clips(timeline)[0]!.id), revision: 2 }];
    const answer = {
      ...where,
      commentId,
      reply: 'Clip 1 plays at half speed now.',
      status: 'resolved',
      changeRefs,
    };
    unwrap(await bus.dispatch(N.reply, answer, agent));
    expect(await get(commentId)).toMatchObject({ status: 'resolved', reply: answer.reply, changeRefs });
    unwrap(await bus.undo(where.projectId, person));
    const undone = await get(commentId);
    expect(undone.status).toBe('open');
    expect(undone.reply).toBeUndefined();
    const no = { ...where, commentId, reply: 'There is no slower take of this.', status: 'open' };
    unwrap(await bus.dispatch(N.reply, no, agent));
    expect(await get(commentId)).toMatchObject({ status: 'open', reply: no.reply });
  });

  it('answer nothing the person dismissed', async () => {
    const { bus, where, add } = await setup();
    const { commentId } = await add();
    unwrap(await bus.dispatch(N.setStatus, { ...where, commentId, status: 'dismissed' }, person));
    const answer = { ...where, commentId, reply: 'Done.', status: 'resolved' };
    expect(code(await bus.dispatch(N.reply, answer, agent))).toBe('core.comment_closed');
  });

  it('announce nothing for a command that failed', async () => {
    const { seen, add, timeline } = await setup();
    await add({ anchor: itemTarget(timeline, newId<'TimelineItem'>()) });
    expect(seen).toEqual([]);
  });
});
