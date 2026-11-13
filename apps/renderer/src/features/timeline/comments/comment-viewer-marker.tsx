// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: comment marker (viewer) · genre: atmospheric studio app (the footage) · system: DESIGN.md v0.3
 * over the viewer's frame, in its top corner: "2 comments here" while the playhead is on something people commented
 *   on (pressing it opens the first in the dock's Comments), and Comment here, which comments on what is under the
 *   playhead at that moment; small chips on the overlay surface so the footage stays the picture
 * states: chips carry default, hover, focus (base ring), active · nothing waiting here (only Comment here) · motion:
 *   none (it changes with the playhead, at once) · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { TimelineComment } from '@taalcut/core';
import { CONCEPT_ICONS, cn, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { currentSelection } from '../../../chat/selection-store';
import { useEditorContext } from '../editor-context';
import { usePlayheadFrame } from '../playhead';
import { commentOn, showComment } from './comment-requests';
import { newCommentOn } from './comment-targets';
import { useCommentWords } from './comment-words';
import { useTimelineComments } from './use-timeline-comments';

const CHIP = cn(
  'pointer-events-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill bg-overlay/90 px-2.5 text-xs font-medium text-ink shadow-sm backdrop-blur-sm',
  'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-overlay active:bg-pressed',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&_svg]:size-3.5',
);

export function CommentViewerMarker() {
  const { t } = useLingui();
  const editor = useEditorContext();
  const { comments } = useTimelineComments(editor?.timeline.id);
  const words = useCommentWords(editor?.timeline ?? null);
  const [here, setHere] = useState<readonly TimelineComment[]>([]);

  const compute = (frame: number) => {
    const covering = comments.filter((comment) => {
      if (comment.status !== 'open' && comment.status !== 'sent') return false;
      // The whole video's comments are everywhere; the marker counts what is on this moment.
      if (comment.anchor.kind === 'timeline') return false;
      const { start, end } = words.place(comment);
      return start !== null && end !== null && frame >= start && frame < Math.max(end, start + 1);
    });
    setHere((previous) =>
      previous.length === covering.length && previous.every((c, i) => c.id === covering[i]?.id)
        ? previous
        : covering,
    );
  };
  usePlayheadFrame(editor?.playhead ?? NO_PLAYHEAD, compute);
  // A comment added or answered changes what is here without the playhead moving.
  const playhead = editor?.playhead;
  useEffect(() => {
    if (playhead) compute(playhead.frame());
  }, [comments, words, playhead]);

  if (!editor) return null;
  const first = here[0];
  return (
    <div
      data-slot="comment-viewer-marker"
      className="pointer-events-none absolute top-2 right-2 flex gap-1.5"
    >
      {first ? (
        <button type="button" className={CHIP} onClick={() => showComment(first.id)}>
          <CONCEPT_ICONS.comment aria-hidden />
          <Plural value={here.length} one="# comment here" other="# comments here" />
        </button>
      ) : null}
      <button
        type="button"
        className={CHIP}
        title={t`Comment on what’s under the playhead (C)`}
        onClick={() => commentOn(newCommentOn(editor.timeline, currentSelection(), editor.playhead.frame()))}
      >
        <VERB_ICONS.comment aria-hidden />
        {t`Comment here`}
      </button>
    </div>
  );
}

/** A playhead that never moves, for the hook outside the editor. */
const NO_PLAYHEAD = {
  frame: () => 0,
  seek: () => {},
  subscribe: () => () => {},
} as unknown as Parameters<typeof usePlayheadFrame>[0];
