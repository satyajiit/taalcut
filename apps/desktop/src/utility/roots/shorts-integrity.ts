// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime, type Timeline } from '@taalcut/core';

/** Styling can change during review; replacing/reordering source material invalidates editorial verification. */
export function shortSourceSignature(timeline: Timeline): string {
  const time = (value: RationalTime) => RationalTime.toSeconds(value);
  return JSON.stringify({
    canvas: timeline.canvas,
    speechTrackId: timeline.speechTrackId ?? null,
    voiceover: timeline.voiceover,
    tracks: timeline.tracks
      .filter((track) => track.kind === 'video' || track.kind === 'audio')
      .map((track) => ({
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        role: track.kind === 'audio' ? track.role : null,
        items: track.items.map((item) =>
          item.type === 'clip'
            ? {
                type: item.type,
                media: item.media.kind,
                assetId: 'assetId' in item.media ? item.media.assetId : null,
                start: time(item.sourceStart),
                duration: time(item.duration),
                speed: item.speed,
                enabled: item.enabled,
                audio: item.audio,
                holdFrame: item.holdFrame ?? null,
              }
            : { type: item.type, duration: 'duration' in item ? time(item.duration) : null },
        ),
      })),
  });
}
