// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One video's part of a batch look (P3-V16) as pure edits: a Style (as `timeline.setStyle`), or one of render's
 * caption presets onto the captions the video already has. A preset on a video without captions is skipped, not
 * an error: the batch result lists it. `restoreLook` is the undo's half: the Style and captions as they were.
 */
import { isDeepStrictEqual } from 'node:util';
import {
  CAPTION_PRESETS,
  ok,
  type CaptionPresetId,
  type CaptionTrack,
  type Result,
  type Style,
  type StyleId,
  type Timeline,
} from '@taalcut/core';
import { unchanged, type EditResult, type TimelinePart } from '../edits/types';
import { withCaptionStyle } from './caption-look';
import { setStyle } from './set-style';

/** What a batch puts on every video: a Style already read from the store, or a caption preset. */
export type BatchLook =
  | { readonly kind: 'style'; readonly style: Style }
  | { readonly kind: 'captionPreset'; readonly presetId: CaptionPresetId };

export type BatchOutcome =
  | { readonly kind: 'edited'; readonly edit: EditResult }
  | { readonly kind: 'skipped'; readonly reason: 'noCaptions' };

export function applyBatchLook(timeline: Timeline, look: BatchLook): Result<BatchOutcome> {
  if (look.kind === 'style') {
    const edited = setStyle(timeline, look.style);
    return edited.ok ? ok({ kind: 'edited', edit: edited.value }) : edited;
  }
  if (!timeline.captions) return ok({ kind: 'skipped', reason: 'noCaptions' });
  const captions = withCaptionStyle(timeline.captions, CAPTION_PRESETS[look.presetId]);
  if (captions === timeline.captions) return ok({ kind: 'edited', edit: { timeline, changed: [] } });
  return ok({ kind: 'edited', edit: { timeline: { ...timeline, captions }, changed: ['captions'] } });
}

/** The look a video had before the batch. */
export interface PriorLook {
  readonly styleId: StyleId | null;
  readonly captions: CaptionTrack | null;
}

export function restoreLook(timeline: Timeline, prior: PriorLook): Result<EditResult> {
  const changed: TimelinePart[] = [];
  if (prior.styleId !== timeline.styleId) changed.push('style');
  if (!isDeepStrictEqual(prior.captions, timeline.captions)) changed.push('captions');
  if (changed.length === 0) return unchanged(timeline);
  return ok({ timeline: { ...timeline, styleId: prior.styleId, captions: prior.captions }, changed });
}
