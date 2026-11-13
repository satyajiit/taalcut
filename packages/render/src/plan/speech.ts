// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime, type Timeline } from '@taalcut/core';
import { speechItems } from '@taalcut/timeline';
import type { PlannedVisual } from './types';

/** The source map captions use. A cutaway's picture never changes these spoken intervals. */
export function planSpeech(timeline: Timeline): PlannedVisual[] {
  const sources: PlannedVisual[] = [];
  let at = 0;
  for (const item of speechItems(timeline)) {
    if (item.type === 'transition') continue;
    const end = at + RationalTime.toFrames(item.duration, timeline.canvas.rate);
    if (item.type === 'clip' && item.media.kind !== 'image' && item.enabled && !item.audio.muted) {
      sources.push({
        id: item.id,
        kind: 'video',
        assetId: item.media.assetId,
        cut: { start: at, end },
        visible: { start: at, end },
        sourceIn: item.sourceStart,
        sourceAtCut: item.sourceStart,
        speed: item.speed,
        meanSpeed: 1,
        fit: 'contain',
        enabled: true,
        slotId: null,
        beat: null,
        audio: item.audio,
        reframe: null,
        stillMotion: null,
        ...(item.holdFrame ? { holdFrame: item.holdFrame } : {}),
      });
    }
    at = end;
  }
  return sources;
}
