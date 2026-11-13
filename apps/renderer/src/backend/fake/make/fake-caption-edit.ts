// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: a caption's words, edited in the fake (the inspector's caption field): the new words share the cue's
 * time out evenly, each at least a frame; empty words take the cue out. ⌘Z puts the captions back as they were.
 */
import {
  CAPTION_COMMANDS,
  captionCommandPayloads,
  defineCommand,
  err,
  RationalTime,
  type AnyCommand,
  type CaptionCue,
} from '@taalcut/core';
import { timelineError } from './edits';
import type { FakeTimelines } from './fake-timelines';

function retimed(cue: CaptionCue, text: string): CaptionCue {
  const words = text.split(/\s+/u).slice(0, 40);
  const rate = cue.range.start.rate;
  const start = cue.range.start.value;
  const length = Math.max(words.length, cue.range.duration.value);
  return {
    ...cue,
    edited: true,
    range: { start: cue.range.start, duration: RationalTime.of(length, rate) },
    words: words.map((word, index) => {
      const from = start + Math.floor((index * length) / words.length);
      const to = start + Math.floor(((index + 1) * length) / words.length);
      return {
        text: word,
        range: {
          start: RationalTime.of(from, rate),
          duration: RationalTime.of(Math.max(1, to - from), rate),
        },
        confidence: 1,
      };
    }),
  };
}

export function createFakeCaptionEdit(timelines: FakeTimelines): AnyCommand {
  return defineCommand({
    name: CAPTION_COMMANDS.editText,
    payload: captionCommandPayloads[CAPTION_COMMANDS.editText],
    sideEffect: 'write',
    project: (p) => p.projectId,
    handle: (p) => {
      const before = timelines.get(p.timelineId);
      if (!before) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
      const captions = before.captions;
      if (!captions?.cues.some((cue) => cue.id === p.cueId))
        return err(timelineError('timeline.item_not_found', { itemId: p.cueId }));
      const text = p.text.trim();
      const cues = captions.cues.flatMap((cue) =>
        cue.id !== p.cueId ? [cue] : text ? [retimed(cue, text)] : [],
      );
      return timelines.write(
        p.projectId,
        before,
        { ok: true, timeline: { ...before, captions: { ...captions, cues } } },
        {
          name: 'timeline.restore',
          payload: { projectId: p.projectId, timelineId: before.id, captions },
        },
      );
    },
  });
}
