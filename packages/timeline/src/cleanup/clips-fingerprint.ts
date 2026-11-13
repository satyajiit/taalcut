// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cleanup plan's `clipsFingerprint` (round P3-3): sha256 (lowercase hex) of canonical JSON of the planned
 * clips as they are (id, media asset and shot, sourceStart, duration, enabled, speed), in timeline order.
 * planCleanup writes it; applyCleanup recomputes it over the clips the plan names, so a plan made before an
 * unrelated edit (a caption, a text, another clip's colour) still applies, and one whose clips changed doesn't.
 */
import type { Clip, Timeline, TimelineItemId } from '@taalcut/core';
import { canonicalJson, sha256Hex } from '@taalcut/templates';
import { videoItems } from '../model/sequence';

/** What the fingerprint covers of one clip: what the plan's kept ranges were computed against. */
function clipFacts(clip: Clip) {
  return {
    id: clip.id,
    asset: clip.media.assetId,
    shot: clip.media.kind === 'video' ? clip.media.shotId : null,
    sourceStart: clip.sourceStart,
    duration: clip.duration,
    enabled: clip.enabled,
    speed: clip.speed,
  };
}

/** The fingerprint of the named clips in timeline order; null when one of them isn't on the video track. */
export function clipsFingerprint(timeline: Timeline, clipIds: readonly TimelineItemId[]): string | null {
  const wanted = new Set(clipIds);
  const clips = videoItems(timeline).filter(
    (item): item is Clip => item.type === 'clip' && wanted.has(item.id),
  );
  if (clips.length !== wanted.size) return null;
  return sha256Hex(canonicalJson(clips.map(clipFacts)));
}
