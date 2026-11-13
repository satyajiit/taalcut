// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a variant differs in from the original (P3-V3), for the editor's compare view, which has the timelines but no
 * card: the same reading as @taalcut/timeline's variantDifference (the hook slot's shot, the share of slots showing
 * another shot, the music, the caption look), over core's types, since the renderer reaches packages only over IPC.
 */
import {
  CAPTION_PRESET_IDS,
  CAPTION_PRESETS,
  type CaptionPresetId,
  type CaptionTrack,
  type Timeline,
  type VariantDifference,
} from '@taalcut/core';

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a);
  const right = new Map(Object.entries(b));
  return (
    left.length === right.size && left.every(([key, value]) => right.has(key) && same(value, right.get(key)))
  );
}

/** Slot id → the shot the slot shows (its shot id, or `asset:<id>` for a photo); null for a gap. In V1 order. */
export function shownBySlot(timeline: Timeline): Map<string, string | null> {
  const shown = new Map<string, string | null>();
  const track = timeline.tracks.find((candidate) => candidate.id === 'V1') ?? timeline.tracks[0];
  if (!track || track.kind !== 'video') return shown;
  for (const item of track.items) {
    if (item.type === 'transition' || !item.slotId) continue;
    if (item.type === 'gap') shown.set(item.slotId, null);
    else if (item.type === 'clip' && item.media.kind !== 'audio')
      shown.set(
        item.slotId,
        item.media.kind === 'video' && item.media.shotId ? item.media.shotId : `asset:${item.media.assetId}`,
      );
  }
  return shown;
}

function captionPresetOf(captions: CaptionTrack | null): CaptionPresetId | null {
  if (!captions) return null;
  return CAPTION_PRESET_IDS.find((id) => same(CAPTION_PRESETS[id], captions.style)) ?? null;
}

export function variantDifference(base: Timeline, variant: Timeline): VariantDifference {
  const left = shownBySlot(base);
  const right = shownBySlot(variant);
  const slots = [...left.keys()];
  const differing = new Set(slots.filter((slotId) => left.get(slotId) !== right.get(slotId)));
  const hook = slots[0];
  return {
    timelineId: variant.id,
    hookChanged: hook !== undefined && differing.has(hook),
    picksChanged: slots.length === 0 ? 0 : differing.size / slots.length,
    music: same(base.music, variant.music) ? null : variant.music,
    captionPreset: same(base.captions?.style ?? null, variant.captions?.style ?? null)
      ? null
      : captionPresetOf(variant.captions),
  };
}
