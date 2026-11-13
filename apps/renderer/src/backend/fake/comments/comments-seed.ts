// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- seeded comments are the person's words: data, never translated */

/** The 'seeded' scenario's comments: one open, one with Taalcut and one done, on the first video with two clips. */
import { editItemsOf, newId, type Timeline, type TimelineComment } from '@taalcut/core';

export function commentsSeed(timelines: readonly Timeline[], now: number): TimelineComment[] {
  const timeline = timelines.find(
    (each) => editItemsOf(each).filter((place) => place.target.itemKind === 'clip').length >= 2,
  );
  if (!timeline) return [];
  const [first, second] = editItemsOf(timeline).filter((place) => place.target.itemKind === 'clip');
  const base = { projectId: timeline.projectId, timelineId: timeline.id, author: 'user' as const };
  const rate = timeline.canvas.rate;
  return [
    {
      ...base,
      id: newId<'TimelineComment'>(),
      anchor: first!.target,
      at: { value: Math.min(12, Math.max(0, first!.end - first!.start - 1)), rate },
      body: 'Start on the wave, not the sand.',
      status: 'open',
      createdAt: now - 3_000,
      updatedAt: now - 3_000,
    },
    {
      ...base,
      id: newId<'TimelineComment'>(),
      anchor: second!.target,
      body: 'A beat shorter here.',
      status: 'resolved',
      reply: 'Clip 2 is a beat shorter now.',
      changeRefs: [{ target: second!.target, revision: timeline.revision }],
      createdAt: now - 2_000,
      updatedAt: now - 1_000,
    },
    {
      ...base,
      id: newId<'TimelineComment'>(),
      anchor: { kind: 'timeline', timelineId: timeline.id },
      body: 'Warmer colours all through.',
      status: 'open',
      createdAt: now - 1_500,
      updatedAt: now - 1_500,
    },
  ];
}
