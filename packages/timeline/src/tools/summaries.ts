// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The compact view of a timeline the agent reads (timeline.get) instead of the whole document. */
import type { Timeline } from '@taalcut/core';
import { positions, videoItems } from '../model/sequence';
import { clipView, editorView } from './editor-view';

export function summarizeTimeline(timeline: Timeline) {
  const slots = new Map(timeline.cast?.slots.map((slot) => [slot.slotId as string, slot]) ?? []);
  const all = positions(videoItems(timeline));
  return {
    id: timeline.id,
    projectId: timeline.projectId,
    name: timeline.name,
    revision: timeline.revision,
    rate: { num: timeline.canvas.rate.num, den: timeline.canvas.rate.den },
    frames: all.at(-1)?.end ?? 0,
    clips: all.map(({ item, start, end }) => {
      const slot = item.slotId ? slots.get(item.slotId) : undefined;
      return {
        clipId: item.id,
        slotId: item.slotId,
        kind: item.type,
        assetId: item.type === 'clip' ? item.media.assetId : null,
        shotId: item.type === 'clip' && item.media.kind === 'video' ? item.media.shotId : null,
        start,
        frames: end - start,
        locked: item.type === 'clip' && item.locked,
        userPick: item.type === 'clip' && slot?.note === 'userPick',
        sourceStart:
          item.type === 'clip'
            ? {
                value: item.sourceStart.value,
                rate: { num: item.sourceStart.rate.num, den: item.sourceStart.rate.den },
              }
            : null,
        confidence: slot?.confidence ?? null,
        ...clipView(item.type === 'clip' ? item : null, start, end, timeline.canvas.rate),
      };
    }),
    texts: timeline.tracks.flatMap((track) =>
      track.kind === 'text'
        ? track.items.flatMap((item) => {
            const timing = { itemId: item.id, start: item.start.value, frames: item.duration.value };
            // HFW1: a graphic is a design whose words are its variables (graphics.list, graphics.edit).
            return item.type === 'text' ? [{ ...timing, text: item.text, origin: item.origin }] : [];
          })
        : [],
    ),
    ...editorView(timeline),
  };
}
