// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a graphic's anchor is matched against (SPEC P3.4): a timeline's caption words, its slots' first frames and its
 * length, at a rate. A graphic the chat proposed (EDT1-GFX) isn't part of the video until it is used: only the
 * preview draws it (`showProposals`). Pure.
 */
import type { FrameRate, Timeline } from '@taalcut/core';
import { captionWords, slotStarts, timelineFrames, type TimingContext } from './timing';

/** The timing context of a timeline: its caption words, slots and length. */
export function timingContextOf(timeline: Timeline, rate: FrameRate): TimingContext {
  return {
    words: captionWords(timeline),
    language: timeline.captions?.language ?? 'en',
    slots: slotStarts(timeline),
    rate,
    durationFrames: timelineFrames(timeline),
  };
}

/** The timeline with its proposed graphics drawn as any other (the preview's, so the person sees one first). */
export function showProposals(timeline: Timeline): Timeline {
  const proposed = timeline.tracks.some(
    (track) => track.kind === 'text' && track.items.some((item) => item.type === 'graphic' && item.proposal),
  );
  if (!proposed) return timeline;
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.kind !== 'text'
        ? track
        : {
            ...track,
            items: track.items.map((item) => {
              if (item.type !== 'graphic' || !item.proposal) return item;
              const { proposal: _shown, ...drawn } = item;
              return drawn;
            }),
          },
    ),
  };
}
