// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-CMT: comments on a timeline, their commands, the comments namespace, the tools and where a target sits. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  APP_ROUTES,
  appContract,
  COMMENT_COMMANDS,
  commentBatchItemSchema,
  commentBatchSchema,
  commentCommandPayloads,
  commentReplyToolInputSchema,
  commentsListToolInputSchema,
  commentsListToolOutputSchema,
  commentToolView,
  editTargetFrame,
  editTargetSpan,
  LIBRARY_ENTITIES,
  messageExtrasShape,
  newId,
  oneLine,
  editItemMap,
  timelineCommentSchema,
  timelineFrames,
  UTILITY_CONTRACTS,
  type EditTarget,
  type TimelineComment,
  type Track,
} from '@taalcut/core';
import { at, captionTrack, json, ntscTimeline, span } from './helpers/documents';

const timeline = { ...ntscTimeline(), captions: captionTrack([[10, 20]]) };
const rate = timeline.canvas.rate;
const [video, audio, text] = timeline.tracks as [
  Extract<Track, { kind: 'video' }>,
  Extract<Track, { kind: 'audio' }>,
  Extract<Track, { kind: 'text' }>,
];
const [first, dissolve, second, gap] = video.items;
const item = (itemId: string, itemKind: Extract<EditTarget, { kind: 'item' }>['itemKind']): EditTarget =>
  ({ kind: 'item', timelineId: timeline.id, itemId, itemKind }) as EditTarget;

function comment(overrides: Partial<TimelineComment> = {}): TimelineComment {
  return {
    id: newId<'TimelineComment'>(),
    projectId: timeline.projectId,
    timelineId: timeline.id,
    anchor: item(second!.id, 'clip'),
    body: 'Make this half speed',
    author: 'user',
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('a timeline comment', () => {
  it('is anchored on its own timeline, with the person’s words', () => {
    expect(timelineCommentSchema.parse(json(comment({ at: at(12, rate) })))).toMatchObject({
      body: 'Make this half speed',
      status: 'open',
    });
    const elsewhere = { kind: 'timeline', timelineId: newId<'Timeline'>() } as EditTarget;
    expect(timelineCommentSchema.safeParse(json(comment({ anchor: elsewhere }))).success).toBe(false);
    expect(timelineCommentSchema.safeParse(json(comment({ body: '   ' }))).success).toBe(false);
    expect(timelineCommentSchema.safeParse(json(comment({ body: 'x'.repeat(1001) }))).success).toBe(false);
    expect(timelineCommentSchema.safeParse(json(comment({ at: at(-1, rate) }))).success).toBe(false);
  });

  it('keeps a reply to one line, and its changes on the same timeline', () => {
    expect(timelineCommentSchema.safeParse(json(comment({ reply: 'Done.\nSlowed it.' }))).success).toBe(
      false,
    );
    expect(oneLine(' Done.\n  Slowed it. ')).toBe('Done. Slowed it.');
    const ref = { target: { kind: 'timeline', timelineId: newId<'Timeline'>() } as EditTarget };
    expect(timelineCommentSchema.safeParse(json(comment({ changeRefs: [ref] }))).success).toBe(false);
  });
});

describe('the comment commands', () => {
  const base = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    commentId: newId<'TimelineComment'>(),
  };
  const P = commentCommandPayloads;

  it('add an anchor of the same timeline', () => {
    const anchor = item(first!.id, 'clip');
    expect(P[COMMENT_COMMANDS.add].safeParse({ ...base, anchor, body: 'Tighter' }).success).toBe(true);
    const other = { ...anchor, timelineId: newId<'Timeline'>() };
    expect(P[COMMENT_COMMANDS.add].safeParse({ ...base, anchor: other, body: 'Tighter' }).success).toBe(
      false,
    );
  });

  it('edit something, set a person’s statuses only, and answer resolved or open', () => {
    expect(P[COMMENT_COMMANDS.edit].safeParse({ ...base, patch: {} }).success).toBe(false);
    expect(P[COMMENT_COMMANDS.edit].parse({ ...base, patch: { at: null } }).patch).toEqual({ at: null });
    expect(P[COMMENT_COMMANDS.setStatus].safeParse({ ...base, status: 'sent' }).success).toBe(false);
    const reply = P[COMMENT_COMMANDS.reply].parse({ ...base, reply: 'Half speed now.', status: 'resolved' });
    expect(reply.changeRefs).toEqual([]);
    expect(P[COMMENT_COMMANDS.reply].safeParse({ ...base, reply: 'x', status: 'dismissed' }).success).toBe(
      false,
    );
  });

  it('send 1–50 comments to a run', () => {
    const send = P[COMMENT_COMMANDS.send];
    const runId = newId<'AgentRun'>();
    const { commentId: _one, ...where } = base;
    expect(send.safeParse({ ...where, runId, commentIds: [] }).success).toBe(false);
    const many = Array.from({ length: 51 }, () => newId<'TimelineComment'>());
    expect(send.safeParse({ ...where, runId, commentIds: many }).success).toBe(false);
    expect(send.safeParse({ ...where, runId, commentIds: many.slice(0, 50) }).success).toBe(true);
  });
});

describe('the comments namespace', () => {
  it('is the agent’s, beside the library entity and a message’s comments', () => {
    expect(APP_ROUTES.comments).toBe('agent');
    expect(UTILITY_CONTRACTS.agent.comments).toBe(appContract.comments);
    expect(LIBRARY_ENTITIES).toContain('comment');
    const comments = z.object(messageExtrasShape).shape.comments;
    expect(comments.safeParse([newId<'TimelineComment'>()]).success).toBe(true);
    expect(comments.safeParse([]).success).toBe(false);
  });
});

describe('where an edit target sits', () => {
  it('maps every item a person can point at by id, and the video’s length', () => {
    const items = editItemMap(timeline);
    expect(items.get(first!.id)).toMatchObject({ start: 0, end: 60, trackId: 'V1' });
    expect(items.get(dissolve!.id)?.target.itemKind).toBe('transition');
    expect(items.get(audio.items[0]!.id)?.target.itemKind).toBe('audio');
    expect(items.get(text.items[1]!.id)).toMatchObject({ start: 30, end: 60 });
    expect(items.get(timeline.captions.cues[0]!.id)).toMatchObject({ start: 10, end: 30 });
    expect(items.has(gap!.id)).toBe(false);
    expect(timelineFrames(timeline)).toBe(150);
  });

  it('spans an item, a range and the whole video, and a moment inside them', () => {
    const range = { kind: 'range', timelineId: timeline.id, range: span(90, 30, rate) } as EditTarget;
    expect(editTargetSpan(timeline, item(second!.id, 'clip'))).toEqual({ start: 60, end: 120 });
    expect(editTargetSpan(timeline, range)).toEqual({ start: 90, end: 120 });
    expect(editTargetSpan(timeline, { kind: 'timeline', timelineId: timeline.id })).toEqual({
      start: 0,
      end: 150,
    });
    expect(editTargetSpan(timeline, item(newId<'TimelineItem'>(), 'clip'))).toBeNull();
    expect(editTargetFrame(timeline, item(second!.id, 'clip'), at(12, rate))).toBe(72);
    expect(editTargetFrame(timeline, item(second!.id, 'clip'), at(500, rate))).toBe(119);
  });
});

describe('the comment tools', () => {
  it('show a comment flat, with its words marked untrusted', () => {
    const view = commentToolView(comment({ at: at(12, rate) }), timeline);
    expect(view).toEqual({
      commentId: expect.any(String),
      status: 'open',
      on: 'clip',
      itemId: second!.id,
      start: 60,
      end: 120,
      frame: 72,
      body: 'Make this half speed',
    });
    expect(commentBatchItemSchema.safeParse(view).success).toBe(true);
    const output = z.toJSONSchema(commentsListToolOutputSchema, { io: 'output', unrepresentable: 'throw' });
    expect(JSON.stringify(output)).toContain('"untrusted":"user-comment"');
    expect(() =>
      z.toJSONSchema(commentsListToolInputSchema, { io: 'input', unrepresentable: 'throw' }),
    ).not.toThrow();
    expect(() =>
      z.toJSONSchema(commentReplyToolInputSchema, { io: 'input', unrepresentable: 'throw' }),
    ).not.toThrow();
  });

  it('say a comment whose item is gone has no span', () => {
    const view = commentToolView(comment({ anchor: item(newId<'TimelineItem'>(), 'text') }), timeline);
    expect(view).toMatchObject({ on: 'text', start: null, end: null });
    expect(view.frame).toBeUndefined();
  });
});

describe('a batch for one run', () => {
  it('holds 1 to 50 comments on one timeline, flat', () => {
    const items = Array.from({ length: 51 }, () => {
      const { status: _s, reply: _r, ...view } = commentToolView(comment(), timeline);
      return view;
    });
    const batch = {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      revision: 1,
      rate: { num: rate.num, den: rate.den },
      comments: items.slice(0, 2),
    };
    expect(commentBatchSchema.safeParse(batch).success).toBe(true);
    expect(commentBatchSchema.safeParse({ ...batch, comments: [] }).success).toBe(false);
    expect(commentBatchSchema.safeParse({ ...batch, comments: items }).success).toBe(false);
    expect(commentBatchSchema.safeParse({ ...batch, revision: 0 }).success).toBe(false);
  });
});
