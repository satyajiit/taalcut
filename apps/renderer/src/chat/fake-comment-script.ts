// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted model output: data, never translated */

/**
 * The fake agent's answer to "Send N comments to Taalcut" (EDT1-CMT): one run that marks the comments sent
 * (`comments.send` on the fake's bus as the agent), then answers each with `comments.reply`, resolved with a line
 * that names what it is on, so the dock's Comments move from With Taalcut to Done, live; then a closing line. It
 * makes no edit (the fake has no editor): only the answers. A comment that asks to export is answered open, with
 * why, as the real Editor does. Reads the fake's comments through `window.taalcutFake`.
 */
import { COMMENT_COMMANDS, type TimelineComment, type TimelineCommentId } from '@taalcut/core';
import { chunks, event, type Beat, type ScriptIds } from './fake-script';

const EXPORT = /\bexport\b/i;

function say(ids: ScriptIds, text: string): Beat[] {
  const { runId, messageId } = ids;
  return chunks(text).map((delta) => ({
    wait: 30,
    event: event('agent.messageDelta', { runId, messageId, delta }),
  }));
}

const answer = (comment: TimelineComment): { reply: string; status: 'resolved' | 'open' } =>
  EXPORT.test(comment.body)
    ? { reply: 'Exporting isn’t an edit: use Export… when the cut is ready.', status: 'open' }
    : { reply: `Done: ${comment.body.replace(/\s+/g, ' ').slice(0, 60)}`, status: 'resolved' };

export function commentScript(ids: ScriptIds, commentIds: readonly TimelineCommentId[]): Beat[] {
  const { runId, conversationId } = ids;
  const start: Beat = { wait: 0, event: event('agent.runStarted', { runId, conversationId }) };
  const end: Beat = { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) };
  const fake = window.taalcutFake;
  const comments = commentIds.flatMap((id) => {
    const found = fake?.phase3.comments.get(id);
    return found && found.status === 'open' ? [found] : [];
  });
  const first = comments[0];
  if (!fake || !first) return [start, ...say(ids, 'Those comments are already answered.'), end];
  const as = { source: 'agent' as const, actor: `agent:${runId}` };
  const where = { projectId: first.projectId, timelineId: first.timelineId };
  const sent: Beat = {
    wait: 0,
    event: (at) => {
      void fake.bus.dispatch(
        COMMENT_COMMANDS.send,
        { ...where, commentIds: comments.map((c) => c.id), runId },
        as,
      );
      return event('agent.reasoningDelta', { runId, delta: `${comments.length} comments to go through. ` })(
        at,
      );
    },
  };
  const replies = comments.flatMap((comment): Beat[] => {
    const toolRunId = ids.toolRunId();
    const { reply, status } = answer(comment);
    return [
      {
        wait: 300,
        event: (at) => {
          void fake.bus.dispatch(
            COMMENT_COMMANDS.reply,
            { ...where, commentId: comment.id, reply, status, changeRefs: [] },
            as,
          );
          return event('agent.toolStarted', {
            runId,
            toolRunId,
            tool: 'comments.reply',
            sideEffect: 'write',
          })(at);
        },
      },
      {
        wait: 200,
        event: event('agent.toolFinished', {
          runId,
          toolRunId,
          tool: 'comments.reply',
          status: 'succeeded',
          durationMs: 200,
        }),
      },
    ];
  });
  return [start, sent, ...replies, ...say(ids, 'I answered each of your comments.'), end];
}
