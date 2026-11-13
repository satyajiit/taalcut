// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timeline.setStyle` as a pure edit (P3-V10, P3-V16): the video names the Style, and when the Style carries a
 * caption look and the video has captions, the captions wear it (`styleSource: 'preset'`). Clearing the Style
 * (null) leaves the captions as they are: their look is theirs once applied.
 */
import { ok, type Result, type Style, type Timeline } from '@taalcut/core';
import { captionStyleOf } from '@taalcut/templates';
import { unchanged, type EditResult, type TimelinePart } from '../edits/types';
import { withCaptionStyle } from './caption-look';

export function setStyle(timeline: Timeline, style: Style | null): Result<EditResult> {
  const styleId = style?.id ?? null;
  const look = style ? captionStyleOf(style) : null;
  const captions = look && timeline.captions ? withCaptionStyle(timeline.captions, look) : timeline.captions;
  const changed: TimelinePart[] = [];
  if (styleId !== timeline.styleId) changed.push('style');
  if (captions !== timeline.captions) changed.push('captions');
  if (changed.length === 0) return unchanged(timeline);
  return ok({ timeline: { ...timeline, styleId, captions }, changed });
}
