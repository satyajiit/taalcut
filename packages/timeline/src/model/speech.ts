// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { SequenceItem, Timeline } from '@taalcut/core';
import { videoItems } from './sequence';

/** A detached speech track is authoritative; a disabled one must not fall back to the cutaway's sound. */
export function speechItems(timeline: Timeline): readonly SequenceItem[] {
  if (!timeline.speechTrackId) return videoItems(timeline);
  const track = timeline.tracks.find((candidate) => candidate.id === timeline.speechTrackId);
  return track?.kind === 'audio' && track.enabled ? track.items : [];
}
