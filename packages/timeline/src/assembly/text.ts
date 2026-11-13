// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text overlays for assembly: one text item per template overlay at the same
 * time, box and look, or, when the reel drew it as a shape (a chat bubble, a
 * pill, a sticker), the composition the AI designed for it (designed.ts; with
 * none, it is left out). The text is the Editor's rewrite for the user's
 * footage when it gave one, else the template's (untrusted reference text,
 * kept as plain text). Text that may be part of the scene, or that the reading
 * of the reel's graphics calls footage (DSG1-READ), is left out until the
 * review keeps it. Overlays shown at once go on separate tracks, T1 first.
 */
import {
  graphicBriefOf,
  isNotGraphic,
  TimeRange,
  type Template,
  type TextItem,
  type TextOverlay,
  type TextTrackItem,
  type TimelineItemId,
  type Track,
} from '@taalcut/core';
import { designedGraphic, leftOut } from './designed';

type TextTrack = Extract<Track, { kind: 'text' }>;

const HANDLE_WATERMARK = /^@[A-Za-z0-9._-]+(?:\s+[A-Za-z0-9._-]+)?\.?$/;

/** Whether a reference overlay is the reference creator's own handle/watermark rather than story copy. */
function isReferenceWatermark(overlay: TextOverlay, template: Template): boolean {
  const brief = graphicBriefOf(template.graphics, overlay.id);
  if (brief && brief.source !== 'person' && /\bwatermark\b/i.test(brief.what)) return true;
  if (HANDLE_WATERMARK.test(overlay.text.trim()) && (!brief || brief.role === 'other')) return true;
  return false;
}

export function textTracksFor(
  template: Template,
  texts: Readonly<Record<string, string>>,
  ids: { item(): TimelineItemId },
): TextTrack[] {
  const tracks: TextTrack[] = [];
  // Text that may be part of the scene (a sign, a shirt) stays out of the video while the doubt stands (BRK1 §1),
  // text the breakdown's reading calls footage stays out until the review restores it (DSG1-READ), and reference
  // creator watermarks (@handle) are never copied onto the user's video.
  const overlays = template.text
    .filter((overlay) => !overlay.doubts?.some((doubt) => doubt.reason === 'textMaybeScene'))
    .filter((overlay) => !isNotGraphic(template.graphics, overlay.id))
    .filter((overlay) => !isReferenceWatermark(overlay, template))
    .sort((a, b) => a.start.value - b.start.value);
  for (const overlay of overlays) {
    const rewrite = texts[overlay.id]?.trim();
    const rewritten = rewrite !== undefined && rewrite.length > 0;
    const words = rewritten ? rewrite : overlay.text;
    const text: TextItem = {
      type: 'text',
      id: ids.item(),
      start: overlay.start,
      duration: overlay.duration,
      text: words,
      role: overlay.role,
      slotId: overlay.slotId,
      overlayId: overlay.id,
      box: overlay.box,
      appearance: overlay.appearance,
      styleKey: overlay.styleKey,
      reveal: overlay.reveal,
      language: overlay.language,
      origin: rewritten ? 'editor' : 'template',
    };
    const graphic = designedGraphic(overlay, { text: words, rewritten, template }, text.id);
    // HFW1 retire: no built-in graphic stands in for a design that isn't there.
    if (!graphic && leftOut(overlay, template)) continue;
    const item: TextTrackItem = graphic ?? text;
    const range = TimeRange.of(item.start, item.duration);
    let track = tracks.find((candidate) =>
      candidate.items.every((other) => !TimeRange.overlaps(range, TimeRange.of(other.start, other.duration))),
    );
    if (!track) {
      const id = `T${tracks.length + 1}`;
      track = { kind: 'text', id, name: id, enabled: true, items: [] };
      tracks.push(track);
    }
    track.items.push(item);
  }
  // Track ids run T1–T9 (core's track pattern); more simultaneous overlays than that don't fit a timeline.
  return tracks.slice(0, 9);
}
