// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  ok,
  ValidationError,
  type ClipVisualLayout,
  type Result,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { videoItems, withVideoItems } from '../model/sequence';
import { clipPosition, type EditOptions, type EditResult } from './types';

export function setVisualLayout(
  timeline: Timeline,
  input: { readonly clipId: TimelineItemId; readonly visualLayout: ClipVisualLayout | null },
  options: EditOptions,
): Result<EditResult> {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  if (found.value.item.media.kind !== 'video') return err(ValidationError({ field: 'clipId' }));
  if (JSON.stringify(found.value.item.visualLayout ?? null) === JSON.stringify(input.visualLayout))
    return ok({ timeline, changed: [] });
  const { visualLayout: _old, ...clip } = found.value.item;
  const items = [...videoItems(timeline)];
  items[found.value.itemIndex] = {
    ...clip,
    ...(input.visualLayout ? { visualLayout: input.visualLayout } : {}),
  };
  return ok({ timeline: withVideoItems(timeline, items), changed: ['tracks'] });
}
