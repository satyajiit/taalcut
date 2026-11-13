// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: comments panel (docked) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the dock's Comments tab: the video's comments in three groups, Open, With Taalcut and
 *   Done, each oldest first, then "Send N comments to Taalcut" pinned under them (the kit's default fill; Export… keeps the screen's marigold): it
 *   sends every open comment in one message to the project's chat, which opens to show the work; each comment moves
 *   to With Taalcut, then to Done with Taalcut's answer (or back to Open with why), live
 * states: loading (quiet lines) · empty (how to comment) · error (the error card, Try again) · nothing open (Send
 *   off, with why) · each control carries the kit's eight · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { Timeline, TimelineComment } from '@taalcut/core';
import { Button, ErrorCard, SkeletonLines } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { CommentRow } from './comment-row';
import { sendComments, showCommentRequests, useLatest } from './comment-requests';
import { useCommentWords } from './comment-words';
import { useTimelineComments } from './use-timeline-comments';

export function CommentsPanel({ timeline }: { timeline: Timeline }) {
  const { t } = useLingui();
  const state = useTimelineComments(timeline.id);
  const words = useCommentWords(timeline);
  const pointed = useLatest(showCommentRequests)?.value.commentId;
  const { comments } = state;
  const open = comments.filter((comment) => comment.status === 'open');
  const sent = comments.filter((comment) => comment.status === 'sent');
  const done = comments.filter((comment) => comment.status === 'resolved' || comment.status === 'dismissed');
  const rows = (list: readonly TimelineComment[]) =>
    list.map((comment) => (
      <CommentRow
        key={comment.id}
        comment={comment}
        timeline={timeline}
        words={words}
        pointed={pointed === comment.id}
      />
    ));

  const send = () => {
    const ids = open.map((comment) => comment.id);
    if (ids.length === 0) return;
    sendComments({
      ids,
      text: t`${plural(ids.length, { one: 'Please make the change in my comment.', other: 'Please make the changes in my # comments.' })}`,
    });
  };

  return (
    <div data-slot="comments-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-2">
        {state.status === 'loading' && comments.length === 0 ? <SkeletonLines lines={3} /> : null}
        {state.error ? <ErrorCard error={state.error} onRetry={state.retry} /> : null}
        {state.status === 'ready' && comments.length === 0 ? (
          <p className="m-0 text-sm text-ink-2">
            {t`Comment on a clip, a line of text or a moment: select it and press C, or right-click it on the timeline. Your comments wait here until you send them to Taalcut together.`}
          </p>
        ) : null}
        <Group title={t`Open`} count={open.length}>
          {rows(open)}
        </Group>
        <Group title={t`With Taalcut`} count={sent.length}>
          {rows(sent)}
        </Group>
        <Group title={t`Done`} count={done.length}>
          {rows(done)}
        </Group>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-rule-subtle px-3 pt-3 pb-3">
        <Button className="w-full" disabled={open.length === 0} onClick={send} data-slot="send-comments">
          {open.length === 0 ? (
            t`Send comments to Taalcut`
          ) : (
            <Plural value={open.length} one="Send # comment to Taalcut" other="Send # comments to Taalcut" />
          )}
        </Button>
        {open.length === 0 && comments.length > 0 ? (
          <p className="m-0 text-xs text-ink-3">{t`Nothing open to send.`}</p>
        ) : null}
      </div>
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="m-0 type-meta font-medium text-ink-2">
        {title} <span className="tabular-nums">{count}</span>
      </h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">{children}</ul>
    </section>
  );
}
