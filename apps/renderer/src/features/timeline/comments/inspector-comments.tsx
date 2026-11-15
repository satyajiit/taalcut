// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: inspector comments · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * at the foot of the inspector, for what it shows (a clip, a line of text, a stretch of time, or the whole video):
 *   Comment… (C) and, when people commented on it, how many are waiting, which opens the first in the dock
 * states: buttons carry the kit's eight · none waiting (only Comment…) · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { Plural, useLingui } from '@lingui/react/macro';
import { sameEditTarget, type EditTarget, type Timeline } from '@taalcut/core';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { toTarget, type EditorSelection } from '../selection';
import { commentOn, showComment } from './comment-requests';
import { useTimelineComments } from './use-timeline-comments';

/** What the inspector shows, as an edit target (selection.ts's `toTarget`); the whole video when nothing is selected. */
export function selectionTarget(selection: EditorSelection, timeline: Timeline): EditTarget {
  return (
    toTarget(selection, timeline.id, timeline.canvas.rate) ?? { kind: 'timeline', timelineId: timeline.id }
  );
}

export function InspectorComments({
  selection,
  timeline,
  compact = false,
}: {
  selection: EditorSelection;
  timeline: Timeline;
  /** MORE1: beside a title, among its other actions: Comment… as its glyph alone, the count after it. */
  compact?: boolean;
}) {
  const { t } = useLingui();
  const target = selectionTarget(selection, timeline);
  const { comments } = useTimelineComments(timeline.id);
  const waiting = comments.filter(
    (comment) =>
      (comment.status === 'open' || comment.status === 'sent') && sameEditTarget(comment.anchor, target),
  );
  const first = waiting[0];
  return (
    <div
      data-slot="inspector-comments"
      className={compact ? 'flex items-center gap-1' : 'mt-auto flex flex-col items-start gap-1 pt-4'}
    >
      {first && !compact ? (
        <Button size="sm" variant="ghost" onClick={() => showComment(first.id)}>
          <Plural value={waiting.length} one="# comment on this" other="# comments on this" />
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className={compact ? 'w-8 px-0' : undefined}
        aria-keyshortcuts="C"
        aria-label={compact ? t`Comment…` : undefined}
        title={t`Comment on this (C)`}
        icon={VERB_ICONS.comment}
        onClick={() => commentOn({ target })}
      >
        {compact ? null : t`Comment…`}
      </Button>
      {first && compact ? (
        <Button size="sm" variant="ghost" onClick={() => showComment(first.id)}>
          <Plural value={waiting.length} one="# comment on this" other="# comments on this" />
        </Button>
      ) : null}
    </div>
  );
}
