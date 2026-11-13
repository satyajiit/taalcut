// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: how a comment names what it is on, in plain words: "Clip 2", "Text 1 · Golden hour", "0:04–0:06", "The
 * whole video", numbered the way the chat and the changes card number items (core's editItemsOf), and where it sits
 * now in canvas frames. Comments on something no longer in the video say so.
 */
import { useLingui } from '@lingui/react/macro';
import {
  editItemMap,
  editTargetFrame,
  editTargetSpan,
  type EditTarget,
  type Timeline,
  type TimelineComment,
} from '@taalcut/core';
import { useTimecode } from '@taalcut/ui';
import { useCallback, useMemo } from 'react';

/** Words a little longer than this are cut with an ellipsis. */
const WORDS_CHARS = 32;

const short = (words: string) =>
  words.length > WORDS_CHARS ? `${words.slice(0, WORDS_CHARS - 1).trimEnd()}…` : words;

export interface CommentPlace {
  /** [start, end) in canvas frames; null when what it was on is gone. */
  readonly start: number | null;
  readonly end: number | null;
  /** The frame it points at: its moment, else its start. */
  readonly frame: number | null;
}

export function useCommentWords(timeline: Timeline | null) {
  const { t } = useLingui();
  const time = useTimecode();
  const items = useMemo(() => (timeline ? editItemMap(timeline) : new Map()), [timeline]);

  const target = useCallback(
    (anchor: EditTarget): string => {
      if (anchor.kind === 'timeline') return t`The whole video`;
      if (anchor.kind === 'range') {
        if (!timeline) return t`A stretch of the video`;
        const span = editTargetSpan(timeline, anchor, items);
        if (!span) return t`A stretch of the video`;
        const from = time.clock(span.start, timeline.canvas.rate);
        const to = time.clock(span.end, timeline.canvas.rate);
        return t`${from}–${to}`;
      }
      const place = items.get(anchor.itemId);
      if (!place) return t`Something no longer in the video`;
      const n = place.number;
      const words = place.words ? short(place.words) : null;
      switch (anchor.itemKind) {
        case 'clip':
          return t`Clip ${n}`;
        case 'text':
          return words ? t`Text ${n} · ${words}` : t`Text ${n}`;
        case 'graphic':
          return words ? t`Graphic ${n} · ${words}` : t`Graphic ${n}`;
        case 'caption':
          return words ? t`Caption ${n} · ${words}` : t`Caption ${n}`;
        case 'audio':
          return t`Sound ${n}`;
        case 'transition':
          return t`Transition ${n}`;
      }
    },
    [t, time, timeline, items],
  );

  const place = useCallback(
    (comment: TimelineComment): CommentPlace => {
      if (!timeline) return { start: null, end: null, frame: null };
      const span = editTargetSpan(timeline, comment.anchor, items);
      return {
        start: span?.start ?? null,
        end: span?.end ?? null,
        frame: editTargetFrame(timeline, comment.anchor, comment.at, items),
      };
    },
    [timeline, items],
  );

  /** "at 0:04", for a comment that points at a moment. */
  const moment = useCallback(
    (comment: TimelineComment): string | null => {
      if (!timeline || !comment.at) return null;
      const frame = editTargetFrame(timeline, comment.anchor, comment.at, items);
      if (frame === null) return null;
      const clock = time.clock(frame, timeline.canvas.rate);
      return t`at ${clock}`;
    },
    [t, time, timeline, items],
  );

  return { target, place, moment };
}

export type CommentWords = ReturnType<typeof useCommentWords>;
