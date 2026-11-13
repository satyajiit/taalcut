// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What render needs from lanes that haven't landed yet, as small ports the
 * composition roots fill. Each says who will own the real implementation.
 */
import type {
  AssetId,
  AsyncResult,
  CommandContext,
  TemplateId,
  TemplateRef,
  Timeline,
  TimelineId,
  Transcript,
} from '@taalcut/core';

/**
 * Timelines by id, and versioned writes for the caption commands.
 * TODO(timeline): @taalcut/timeline's repository (migrate, validate, put with the expected revision);
 * `timelineAccessOverStore` adapts core's TimelineStore meanwhile.
 */
export interface TimelineAccess {
  get(timelineId: TimelineId): AsyncResult<Timeline>;
  /** Applies `mutate` to the latest revision and stores it as revision + 1 (core.conflict on a race). */
  update(
    timelineId: TimelineId,
    mutate: (timeline: Timeline) => Timeline,
    context?: CommandContext,
  ): AsyncResult<Timeline>;
  /** The timeline as it was at `revision` (a saved version), when the store keeps versions. */
  atRevision?(timelineId: TimelineId, revision: number): AsyncResult<Timeline>;
}

/** Word timings per asset, in source time. TODO(audio, library): the stored transcripts of P2-L8. */
export interface TranscriptSource {
  transcript(assetId: AssetId): AsyncResult<Transcript | null>;
}

/**
 * Path d's music (REF1, SPEC section 8): the reel the template keeps on this Mac. Render reads the audio stream
 * of the kept `reference.mp4` itself; its time zero is the beat map's zero. `keptReferenceAudio`
 * (music/reference-audio.ts) builds one from the template's kept media; the composition root gives it the store.
 */
export interface ReferenceAudioSource {
  /**
   * The kept reel's file (video and audio) for this template, or null when there is nothing to play: no kept
   * media, a silent reel, or a file that is gone.
   */
  file(templateId: TemplateId): AsyncResult<string | null>;
  /**
   * The reel's link and its sound's credit, for "add this sound in the app" (path a, or the music turned off).
   * Absent, or null fields: not known.
   */
  credit?(template: TemplateRef): AsyncResult<ReferenceCredit>;
}

/** What the "add this sound in the app" steps name: core's PlatformSoundSteps' `referenceUrl` and `soundLabel`. */
export interface ReferenceCredit {
  readonly referenceUrl: string | null;
  readonly soundLabel: string | null;
}

/**
 * Asset files on disk. TODO(library, media): originals from the library's locations, proxies and
 * conformed files from media's derived cache.
 */
export interface AssetFiles {
  /** The original's absolute path and its fingerprint, or null when it is offline. */
  original(
    assetId: AssetId,
  ): AsyncResult<{ readonly path: string; readonly size: number; readonly mtimeMs: number } | null>;
  /** A preview-friendly proxy (with audio), or null when there is none yet. */
  proxy(assetId: AssetId): AsyncResult<string | null>;
}
