// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: the stand-in's Editor step for three comments (make-flow-comments.ts): comments.list, then for each sent
 * comment its change and comments.reply (a line of text edited first), then a handoff at the timeline's revision.
 */
import { describe, expect, it } from 'vitest';
import type { RequestView, ToolCall } from '../src/anthropic-view';
import { COMMENTED_TEXT, MAKE_FLOW_COMMENTS_ASK } from '../src/make-flow-comments';
import { makeFlowTurn } from '../src/make-flow-script';

const PROJECT = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const TIMELINE = '01JABCDEFGHJKMNPQRSTVWXYZ1';
const TOOLS = ['findTools', 'handOff', 'comments_list', 'comments_reply', 'timeline_editText'];
const comment = (n: number, on: string) => ({
  commentId: `01JABCDEFGHJKMNPQRSTVWXYC${n}`,
  status: 'sent',
  on,
  itemId: `01JABCDEFGHJKMNPQRSTVWXYI${n}`,
  start: n * 30,
  end: n * 30 + 30,
  body: `[untrusted ${n}]`,
});
const listed: ToolCall = {
  name: 'comments_list',
  input: { timelineId: TIMELINE },
  result: `${JSON.stringify({ timelineId: TIMELINE, revision: 4, comments: [comment(1, 'clip'), comment(2, 'text')] })}\n\n<untrusted id="1" source="user-comment">\nOpen wide\n</untrusted>\n<untrusted id="2" source="user-comment">\nSay golden hour\n</untrusted>`,
};
const view = (calls: ToolCall[], skill = 'timeline.editor'): RequestView => ({
  ask: MAKE_FLOW_COMMENTS_ASK,
  skill,
  input: { projectId: PROJECT, timelineId: TIMELINE },
  calls,
  tools: TOOLS,
});
const replied = (n: number): ToolCall => ({
  name: 'comments_reply',
  input: { commentId: comment(n, '').commentId },
  result: '{}',
});

describe('stand-in Editor step for comments', () => {
  it('lists, answers the clip, edits then answers the text, and hands off the edit’s revision', () => {
    expect(makeFlowTurn(view([])).toolCall).toEqual({
      name: 'comments_list',
      args: { timelineId: TIMELINE },
    });
    const first = makeFlowTurn(view([listed])).toolCall!;
    expect(first.name).toBe('comments_reply');
    expect(first.args).toMatchObject({
      commentId: comment(1, '').commentId,
      status: 'resolved',
      changed: [],
    });
    expect(String(first.args.reply)).toContain('Open wide');
    expect(makeFlowTurn(view([listed, replied(1)])).toolCall).toEqual({
      name: 'timeline_editText',
      args: { projectId: PROJECT, timelineId: TIMELINE, itemId: comment(2, '').itemId, text: COMMENTED_TEXT },
    });
    const edit: ToolCall = {
      name: 'timeline_editText',
      input: { itemId: comment(2, '').itemId },
      result: JSON.stringify({ timelineId: TIMELINE, revision: 5 }),
    };
    expect(makeFlowTurn(view([listed, replied(1), edit])).toolCall).toMatchObject({
      name: 'comments_reply',
      args: { commentId: comment(2, '').commentId, changed: [comment(2, '').itemId] },
    });
    expect(makeFlowTurn(view([listed, replied(1), edit, replied(2)])).toolCall).toEqual({
      name: 'handOff',
      args: { timelineId: TIMELINE, revision: 5 },
    });
  });
});
