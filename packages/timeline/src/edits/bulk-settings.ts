// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  NEUTRAL_GRADE,
  ok,
  ValidationError,
  type Clip,
  type ClipAudio,
  type ClipReframe,
  type GradePatch,
  type Result,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { ClipLocked, ItemNotFound } from '../errors';
import type { EditResult } from './types';

type Settings = {
  color?: GradePatch;
  sound?: Partial<ClipAudio>;
  framing?: { fit: Clip['fit']; reframe: ClipReframe | null };
};
type Setting = 'color' | 'sound' | 'framing';

function selected(timeline: Timeline, ids: readonly TimelineItemId[]): Result<Clip[]> {
  const clips = timeline.tracks.flatMap((track) =>
    track.items.filter((item): item is Clip => item.type === 'clip'),
  );
  const found: Clip[] = [];
  for (const id of new Set(ids)) {
    const clip = clips.find((item) => item.id === id);
    if (!clip) return err(ItemNotFound({ itemId: id }));
    if (clip.locked) return err(ClipLocked({ clipId: id }));
    found.push(clip);
  }
  return ok(found);
}

/** Validate the complete target set before building a new document, so a refused item never partially applies. */
export function adjustClips(
  timeline: Timeline,
  ids: readonly TimelineItemId[],
  settings: Settings,
): Result<EditResult> {
  const clips = selected(timeline, ids);
  if (!clips.ok) return clips;
  for (const clip of clips.value) {
    if ((settings.color || settings.framing) && clip.media.kind === 'audio')
      return err(ValidationError({ field: 'clipIds' }, { detail: 'Audio clips have no color or framing' }));
    if (settings.sound && clip.media.kind === 'image')
      return err(ValidationError({ field: 'clipIds' }, { detail: 'Still images have no source sound' }));
    if (settings.framing?.reframe && clip.media.kind !== 'video')
      return err(ValidationError({ field: 'framing' }, { detail: 'Reframing requires video' }));
  }
  const targets = new Set(ids);
  const tracks = timeline.tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      if (item.type !== 'clip' || !targets.has(item.id)) return item;
      return {
        ...item,
        ...(settings.color ? { grade: { ...NEUTRAL_GRADE, ...item.grade, ...settings.color } } : {}),
        ...(settings.sound ? { audio: { ...item.audio, ...settings.sound } } : {}),
        ...(settings.framing ?? {}),
      };
    }),
  })) as Timeline['tracks'];
  return ok({ timeline: { ...timeline, tracks }, changed: ['tracks'] });
}

export function copyClipSettings(
  timeline: Timeline,
  sourceId: TimelineItemId,
  ids: readonly TimelineItemId[],
  settings: readonly Setting[],
): Result<EditResult> {
  const source = timeline.tracks
    .flatMap((track) =>
      track.kind === 'text' ? [] : track.items.filter((item): item is Clip => item.type === 'clip'),
    )
    .find((item) => item.id === sourceId);
  if (source?.type !== 'clip') return err(ItemNotFound({ itemId: sourceId }));
  if (settings.includes('sound') && source.media.kind === 'image')
    return err(ValidationError({ field: 'sourceClipId' }, { detail: 'The source has no sound settings' }));
  if (settings.some((setting) => setting !== 'sound') && source.media.kind === 'audio')
    return err(ValidationError({ field: 'sourceClipId' }, { detail: 'The source has no picture settings' }));
  return adjustClips(timeline, ids, {
    ...(settings.includes('color') ? { color: source.grade ?? NEUTRAL_GRADE } : {}),
    ...(settings.includes('sound')
      ? {
          sound: {
            ...source.audio,
            fadeIn: source.audio.fadeIn ?? { value: 0, rate: timeline.canvas.rate },
            fadeOut: source.audio.fadeOut ?? { value: 0, rate: timeline.canvas.rate },
          },
        }
      : {}),
    ...(settings.includes('framing') ? { framing: { fit: source.fit, reframe: source.reframe } } : {}),
  });
}
