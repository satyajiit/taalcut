// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: comment row · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * one comment in the dock's Comments: what it is on (pressing it goes there) and its moment, its status in words
 *   (With Taalcut, Done, Not done, Dismissed), the person's words, Taalcut's one-line answer under them, then its
 *   actions: Edit and Remove while open (and Done, to close it yourself), Reopen once closed; Edit turns the words
 *   into a field in place
 * states: default · the one a pin or the viewer points at (marigold rule at its start, scrolled into view) ·
 *   editing (field, Save, Cancel) · saving (the button spins) · each control carries the kit's eight · pre-emit
 *   critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { COMMENT_COMMANDS, type Timeline, type TimelineComment } from '@taalcut/core';
import { Badge, Button, cn, UserContent } from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { useCommand } from '../../../backend/use-command';
import { CommentField } from './comment-field';
import { goToComment } from './comment-requests';
import type { CommentWords } from './comment-words';

export interface CommentRowProps {
  comment: TimelineComment;
  timeline: Timeline;
  words: CommentWords;
  /** The one a pin or the viewer pointed at. */
  pointed: boolean;
}

export function CommentRow({ comment, timeline, words, pointed }: CommentRowProps) {
  const { t } = useLingui();
  const { run, pending } = useCommand();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const row = useRef<HTMLLIElement>(null);
  const where = { projectId: timeline.projectId, timelineId: timeline.id, commentId: comment.id };
  const on = words.target(comment.anchor);
  const moment = words.moment(comment);

  useEffect(() => {
    if (pointed) row.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [pointed]);

  const setStatus = (status: 'open' | 'resolved' | 'dismissed') =>
    void run({ name: COMMENT_COMMANDS.setStatus, payload: { ...where, status } });
  const save = async () => {
    const next = body.trim();
    if (!next || pending) return;
    if (next === comment.body) return setEditing(false);
    const result = await run({ name: COMMENT_COMMANDS.edit, payload: { ...where, patch: { body: next } } });
    if (result.ok) setEditing(false);
  };

  const status =
    comment.status === 'sent'
      ? { tone: 'ai' as const, word: t`With Taalcut` }
      : comment.status === 'resolved'
        ? { tone: 'success' as const, word: t`Done` }
        : comment.status === 'dismissed'
          ? { tone: 'neutral' as const, word: t`Dismissed` }
          : comment.reply
            ? { tone: 'warning' as const, word: t`Not done` }
            : null;

  return (
    <li
      ref={row}
      data-slot="comment-row"
      data-comment-id={comment.id}
      data-status={comment.status}
      className={cn(
        'flex flex-col gap-1.5 border-s-2 py-1 ps-3',
        pointed ? 'border-primary-strong' : 'border-transparent',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="min-w-0 cursor-pointer truncate rounded-sm text-start text-sm font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          title={comment.anchor.kind === 'timeline' ? undefined : t`Go to ${on}`}
          onClick={() => goToComment(comment)}
        >
          {on}
        </button>
        {moment ? <span className="shrink-0 text-xs text-ink-3 tabular-nums">{moment}</span> : null}
        {status ? (
          <Badge tone={status.tone} className="ms-auto shrink-0">
            {status.word}
          </Badge>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <CommentField
            label={t`Your comment`}
            value={body}
            onChange={setBody}
            onSubmit={() => void save()}
            disabled={pending}
            autoFocus
          />
          <div className="flex gap-1">
            <Button size="sm" disabled={!body.trim()} loading={pending} onClick={() => void save()}>
              {t`Save`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setBody(comment.body);
                setEditing(false);
              }}
            >
              {t`Cancel`}
            </Button>
          </div>
        </div>
      ) : (
        <p className="m-0 text-sm break-words text-ink">
          <UserContent>{comment.body}</UserContent>
        </p>
      )}
      {comment.reply ? (
        <p data-slot="comment-reply" className="m-0 text-sm text-ink-2">
          <span className="font-medium text-ink">{t`Taalcut:`}</span>{' '}
          <UserContent>{comment.reply}</UserContent>
        </p>
      ) : null}
      {comment.changeRefs && comment.changeRefs.length > 0 ? (
        <div data-slot="comment-changes" className="flex flex-wrap items-center gap-1.5">
          {comment.changeRefs.map((ref, index) => {
            const label = words.target(ref.target);
            return (
              <button
                key={`${index}:${label}`}
                type="button"
                data-slot="comment-change-ref"
                className="cursor-pointer rounded-pill border border-rule-subtle bg-surface-1 px-2 py-0.5 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                title={ref.target.kind === 'timeline' ? undefined : t`Go to ${label}`}
                onClick={() => goToComment({ ...comment, anchor: ref.target, at: undefined })}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      {editing || comment.status === 'sent' ? null : (
        <div className="flex flex-wrap gap-1">
          {comment.status === 'open' ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t`Edit`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStatus('resolved')}>
                {t`Mark done`}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setStatus('open')}>
              {t`Reopen`}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void run({ name: COMMENT_COMMANDS.remove, payload: where })}
          >
            {t`Remove`}
          </Button>
        </div>
      )}
    </li>
  );
}
