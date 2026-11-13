// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.setReframe (P3-V2, Timeline v2): which part of a video clip's frame shows and how zoomed. Render
 * draws it (render SPEC P3.2); null goes back to Phase 2 behaviour (`fit` decides). Video clips only; agents
 * can't change a clip the user locked. Moves no cut.
 */
import {
  err,
  ok,
  ValidationError,
  type ClipReframe,
  type Result,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { videoItems, withVideoItems } from '../model/sequence';
import { clipPosition, type EditOptions, type EditResult } from './types';

export function setReframe(
  timeline: Timeline,
  input: { readonly clipId: TimelineItemId; readonly reframe: ClipReframe | null },
  options: EditOptions,
): Result<EditResult> {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const clip = found.value.item;
  if (clip.media.kind !== 'video')
    return err(ValidationError({ field: 'clipId' }, { detail: 'Only a video clip is reframed' }));
  if (!clip.visualLayout && JSON.stringify(clip.reframe) === JSON.stringify(input.reframe))
    return ok({ timeline, changed: [] });
  const items = [...videoItems(timeline)];
  const { visualLayout: _layout, ...ordinary } = clip;
  items[found.value.itemIndex] = { ...ordinary, reframe: input.reframe };
  return ok({ timeline: withVideoItems(timeline, items), changed: ['tracks'] });
}
