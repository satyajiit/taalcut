// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: comment pins · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * a small speech mark on the ruler's lower edge for each comment still waiting: open in ink (the strongest mark on
 *   the bed after the playhead), sent to Taalcut as a hollow mark; at the moment it points at, else its start;
 *   pressing one opens it in the dock's Comments and puts the playhead there. Answered comments leave the bed
 * states: default · hover (the comment's words in a tooltip) · focus (base ring) · active · the one the dock points at (marigold ring) · none
 *   (nothing drawn) · motion: none of its own · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { TimelineComment } from '@taalcut/core';
import { cn, CONCEPT_ICONS, Tooltip, TooltipContent, TooltipTrigger, UserContent } from '@taalcut/ui';
import { useEditorContext } from '../editor-context';
import { goToComment, showComment, showCommentRequests, useLatest } from './comment-requests';
import { useCommentWords } from './comment-words';
import { useTimelineComments } from './use-timeline-comments';

const WAITING = new Set<TimelineComment['status']>(['open', 'sent']);

export function CommentPins({ pxPerFrame }: { readonly pxPerFrame: number }) {
  const { t } = useLingui();
  const editor = useEditorContext();
  const { comments } = useTimelineComments(editor?.timeline.id);
  const words = useCommentWords(editor?.timeline ?? null);
  const shown = useLatest(showCommentRequests)?.value.commentId;
  if (!editor) return null;
  const pins = comments.flatMap((comment) => {
    // A comment on the whole video, with no moment, is everywhere: it waits in the dock, not as a pin at 0:00.
    if (!WAITING.has(comment.status) || (comment.anchor.kind === 'timeline' && !comment.at)) return [];
    const { frame } = words.place(comment);
    return frame === null ? [] : [{ comment, frame }];
  });
  if (pins.length === 0) return null;
  return (
    <div data-slot="comment-pins" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-7">
      {pins.map(({ comment, frame }) => {
        const on = words.target(comment.anchor);
        const label = comment.status === 'sent' ? t`Comment on ${on}, with Taalcut` : t`Comment on ${on}`;
        return (
          <Tooltip key={comment.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-comment-id={comment.id}
                data-status={comment.status}
                aria-label={label}
                // The person's words, as they wrote them (never translated).
                aria-description={comment.body}
                className={cn(
                  'pointer-events-auto absolute bottom-0 flex size-6 -translate-x-1/2 translate-y-1/2 cursor-pointer items-center justify-center rounded-full shadow-sm',
                  'transition-transform duration-(--dur-micro) ease-(--ease-out) active:scale-95',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                  comment.status === 'open'
                    ? 'bg-ink text-on-inverse'
                    : 'border border-dashed border-ink-2 bg-raised text-ink-2',
                  shown === comment.id && 'ring-2 ring-primary-strong',
                )}
                style={{ left: frame * pxPerFrame }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  showComment(comment.id);
                  goToComment(comment);
                }}
              >
                <CONCEPT_ICONS.comment aria-hidden className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64">
              <span className="block font-medium">{label}</span>
              <UserContent className="line-clamp-3">{comment.body}</UserContent>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
