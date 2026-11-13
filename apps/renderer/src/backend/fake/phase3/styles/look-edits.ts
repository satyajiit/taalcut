// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The look edits of @taalcut/timeline (src/styles/set-style.ts, batch-style.ts, caption-look.ts) as pure
 * functions on a Timeline, for the fake's timeline.setStyle and batch.applyStyle: the video names the Style, its
 * captions wear the Style's caption look (`styleSource: 'preset'`); clearing the Style leaves the captions be; a
 * caption preset on a video without captions is skipped ('noCaptions'). The same object back means unchanged.
 */
import {
  CAPTION_PRESETS,
  type CaptionPresetId,
  type CaptionStyle,
  type CaptionTrack,
  type Style,
  type StyleId,
  type Timeline,
} from '@taalcut/core';

/** What setStyle reads of a Style. */
export type StyleLook = Pick<Style, 'id' | 'captions'>;

export type BatchLook =
  | { readonly kind: 'style'; readonly style: StyleLook }
  | { readonly kind: 'captionPreset'; readonly presetId: CaptionPresetId };

/** JSON-equal, whatever the key order (the real handlers use isDeepStrictEqual). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}

/** The captions with `style` as their look; the same object when nothing would change. */
export function withCaptionStyle(captions: CaptionTrack, style: CaptionStyle): CaptionTrack {
  if (captions.styleSource === 'preset' && sameValue(captions.style, style)) return captions;
  return { ...captions, style, styleSource: 'preset' };
}

/** timeline.setStyle's edit. */
export function setStyle(timeline: Timeline, style: StyleLook | null): Timeline {
  const styleId = style?.id ?? null;
  const look = style?.captions ?? null;
  const captions = look && timeline.captions ? withCaptionStyle(timeline.captions, look) : timeline.captions;
  if (styleId === timeline.styleId && captions === timeline.captions) return timeline;
  return { ...timeline, styleId, captions };
}

/** One video's part of batch.applyStyle: the edited video, or skipped. */
export function applyBatchLook(timeline: Timeline, look: BatchLook): Timeline | 'noCaptions' {
  if (look.kind === 'style') return setStyle(timeline, look.style);
  if (!timeline.captions) return 'noCaptions';
  const captions = withCaptionStyle(timeline.captions, CAPTION_PRESETS[look.presetId]);
  return captions === timeline.captions ? timeline : { ...timeline, captions };
}

/** batch.restoreStyles' edit: the Style and captions as they were before the batch. */
export function restoreLook(
  timeline: Timeline,
  prior: { readonly styleId: StyleId | null; readonly captions: CaptionTrack | null },
): Timeline {
  if (prior.styleId === timeline.styleId && sameValue(prior.captions, timeline.captions)) return timeline;
  return { ...timeline, styleId: prior.styleId, captions: prior.captions };
}
