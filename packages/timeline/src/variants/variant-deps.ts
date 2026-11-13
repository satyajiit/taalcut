// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the music axis of `timeline.makeVariants` (P3-V3) needs from outside the timeline, the same facts
 * `music.choosePath` uses: the beats of an own track so the cuts follow it. Since REF1 the reel's own music needs no
 * acknowledgement, and its beat map comes from the template reader the variants already have.
 */
import type { AssetId, AsyncResult, BeatMap } from '@taalcut/core';

export interface VariantMusicDeps {
  /** An own track's beat map in the track's time; null when it has none. Absent: the cuts stay where they are. */
  readonly trackBeats?: (assetId: AssetId, signal?: AbortSignal) => AsyncResult<BeatMap | null>;
}
