// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render QA's command fixes (P2-M8): timeline.setClipFit for black bars and
 * timeline.resyncBeats for cuts that drifted off the beat grid.
 */
import { err, ok, type CLIP_FITS, type Result, type Timeline, type TimelineItemId } from '@taalcut/core';
import { ClipLocked } from '../errors';
import { videoItems, withVideoItems } from '../model/sequence';
import { resyncToBeatMap } from '../resync/resync';
import { clipPosition, unchanged, type EditOptions, type EditResult } from './types';

export function setClipFit(
  timeline: Timeline,
  input: { readonly clipId: TimelineItemId; readonly fit: (typeof CLIP_FITS)[number] },
  options: EditOptions,
): Result<EditResult> {
  const position = clipPosition(timeline, input.clipId, options.source);
  if (!position.ok) return position;
  if (!position.value.item.visualLayout && position.value.item.fit === input.fit) return unchanged(timeline);
  const items = [...videoItems(timeline)];
  const { visualLayout: _layout, ...ordinary } = position.value.item;
  items[position.value.itemIndex] = { ...ordinary, fit: input.fit };
  return ok({ timeline: withVideoItems(timeline, items), changed: ['tracks'] });
}

/**
 * Every cut, the end included, back onto the timeline's own beat grid (re-sync with every cut free to move). No
 * beat map, or cuts already on it, changes nothing. An agent can't move a clip the user locked.
 */
export function resyncBeats(timeline: Timeline, options: EditOptions): Result<EditResult> {
  if (!timeline.beatMap) return unchanged(timeline);
  const next = resyncToBeatMap(timeline, timeline.beatMap, {
    ...(options.config ? { config: options.config } : {}),
    ...(options.ids ? { ids: options.ids } : {}),
  });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const tracksChanged = !same(next.tracks, timeline.tracks);
  if (!tracksChanged && same(next.markers, timeline.markers)) return unchanged(timeline);
  if (options.source === 'agent') {
    const after = new Map(videoItems(next).map((item) => [item.id, item]));
    for (const item of videoItems(timeline)) {
      if (item.type === 'clip' && item.locked && !same(item, after.get(item.id)))
        return err(ClipLocked({ clipId: item.id }));
    }
  }
  return ok({ timeline: next, changed: tracksChanged ? ['tracks', 'markers'] : ['markers'] });
}
