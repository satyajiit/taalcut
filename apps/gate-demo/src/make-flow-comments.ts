// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A compact, visible cursor records replies; only the current comment's actual content is read. */
import { resultJson, type RequestView } from './anthropic-view';
import {
  call,
  callsTo,
  collectionSize,
  notes,
  readCall,
  record,
  use,
  withNote,
  withReads,
} from './make-flow-reads';
import type { DemoTurn } from './script';

export const MAKE_FLOW_COMMENTS_ASK = 'Please make the changes in my 3 comments.';
export const COMMENTED_TEXT = 'Golden hour at the market';
export const isCommentsAsk = (ask: string): boolean => ask.includes(MAKE_FLOW_COMMENTS_ASK);
const PREFIX = '[stand-in comments] ';
const STORED = /^(?:Stored as (?:artifact|result)|\[Taalcut\] Read result) /;
interface Progress {
  listId?: string;
  receipt?: string;
  count?: number;
  index: number;
  done: string[];
  revision?: number;
  pending?: { index: number; id: string };
  edited?: string;
}

export function commentsTurn(view: RequestView): DemoTurn {
  const { projectId, timelineId } = record(view.input);
  const saved = notes(view, PREFIX).at(-1);
  const state: Progress = saved ? (JSON.parse(JSON.stringify(saved)) as Progress) : { index: 0, done: [] };
  const finish = (turn: DemoTurn) => withNote(turn, PREFIX + JSON.stringify(state));
  for (const reply of callsTo(view, 'comments_reply')) {
    if (reply.result.startsWith('Error '))
      return { text: `I could not resolve the comment: ${reply.result}` };
    const id = reply.input.commentId;
    if (reply.result && typeof id === 'string' && !state.done.includes(id)) state.done.push(id);
  }
  if (state.pending && state.done.includes(state.pending.id)) {
    state.index = state.pending.index + 1;
    delete state.pending;
    delete state.edited;
  }
  for (const edit of callsTo(view, 'timeline_editText')) {
    const revision = resultJson(edit.result)?.revision;
    if (typeof revision === 'number') {
      state.revision = revision;
      state.edited = String(edit.input.itemId);
    }
  }
  let result = callsTo(view, 'comments_list').at(-1);
  if (result) {
    if (state.listId && result.id && state.listId !== result.id) {
      state.index = 0;
      delete state.pending;
    }
    state.listId = result.id;
    if (STORED.test(result.result)) state.receipt = result.result;
    state.count = collectionSize(view, result, 'comments') ?? state.count;
  } else if (state.receipt)
    result = { id: state.listId, name: 'comments_list', input: { timelineId }, result: state.receipt };
  if (!result) return finish(call(view, 'comments_list', { timelineId }, 'Reading your comments.'));
  const current = view.calls.includes(result) ? view : { ...view, calls: [result, ...view.calls] };
  if (state.revision === undefined) {
    const revision = readCall(current, result, { revision: '/revision' });
    if (revision.turn) return finish(revision.turn);
    if (typeof revision.json.revision !== 'number')
      return { text: 'I could not observe the comments’ timeline revision.' };
    state.revision = revision.json.revision;
  }
  for (; state.index < (state.count ?? 200); state.index++) {
    const read = readCall(current, result, { comment: `/comments/${state.index}` });
    if (read.turn) return finish(read.turn);
    const comment = record(read.json.comment);
    if (comment.commentId === undefined) break;
    if (comment.status !== 'sent' || state.done.includes(String(comment.commentId))) continue;
    state.pending = { index: state.index, id: String(comment.commentId) };
    if (comment.on === 'text' && state.edited !== comment.itemId)
      return finish(
        withReads(
          call(view, 'timeline_editText', {
            projectId,
            timelineId,
            itemId: comment.itemId,
            text: COMMENTED_TEXT,
          }),
          read,
        ),
      );
    return finish(
      withReads(
        call(view, 'comments_reply', {
          commentId: comment.commentId,
          reply:
            comment.on === 'text'
              ? `The text reads “${COMMENTED_TEXT}” now.`
              : `I kept this clip: “${String(comment.body ?? '')
                  .trim()
                  .slice(0, 60)}” needs footage the library doesn't have.`,
          status: 'resolved',
          changed: comment.on === 'text' && comment.itemId ? [comment.itemId] : [],
        }),
        read,
      ),
    );
  }
  return finish(use('handOff', { timelineId, revision: state.revision }));
}
