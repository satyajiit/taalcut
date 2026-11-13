// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a generated still goes: the slot's item on the video track (a gap the still fills, or the clip it
 * would replace), read from the stored timeline through core's port, and the aspect the canvas asks for.
 */
import {
  err,
  NotFoundError,
  ok,
  upgradeTimeline,
  type AsyncResult,
  type ProjectId,
  type SlotId,
  type TimelineId,
  type TimelineItemId,
  type TimelineStore,
} from '@taalcut/core';
import type { ImageAspect } from './image-types';

export type SlotItem =
  | { readonly kind: 'gap'; readonly itemId: TimelineItemId }
  | { readonly kind: 'clip'; readonly itemId: TimelineItemId; readonly locked: boolean };

export interface SlotPlace {
  readonly item: SlotItem;
  readonly aspect: ImageAspect;
  readonly revision: number;
}

/** The slot's item on the first video track and the canvas's aspect; core.not_found when it isn't there. */
export async function slotPlace(
  timelines: Pick<TimelineStore, 'get'>,
  target: { readonly projectId: ProjectId; readonly timelineId: TimelineId; readonly slotId: SlotId },
): AsyncResult<SlotPlace> {
  const stored = await timelines.get(target.timelineId);
  if (!stored.ok) return stored;
  const timeline = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
  if (!timeline.ok) return timeline;
  if (timeline.value.projectId !== target.projectId)
    return err(NotFoundError({ entity: 'timeline', id: target.timelineId }));
  const video = timeline.value.tracks.find((track) => track.kind === 'video');
  const found =
    video?.kind === 'video'
      ? video.items.find((item) => item.type !== 'transition' && item.slotId === target.slotId)
      : undefined;
  if (!found || found.type === 'transition') return err(NotFoundError({ entity: 'slot', id: target.slotId }));
  const item: SlotItem =
    found.type === 'gap'
      ? { kind: 'gap', itemId: found.id }
      : { kind: 'clip', itemId: found.id, locked: found.locked };
  return ok({ item, aspect: aspectOf(timeline.value.canvas), revision: timeline.value.revision });
}

/** The supported aspect nearest the canvas's. */
export function aspectOf(canvas: { readonly width: number; readonly height: number }): ImageAspect {
  const ratio = canvas.width / canvas.height;
  const options: readonly [ImageAspect, number][] = [
    ['9:16', 9 / 16],
    ['4:5', 4 / 5],
    ['1:1', 1],
    ['16:9', 16 / 9],
  ];
  return options.reduce((best, option) =>
    Math.abs(Math.log(option[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? option : best,
  )[0];
}
