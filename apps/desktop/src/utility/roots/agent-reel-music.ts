// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the bars of a template's kept reel, for timeline's length tools (timeline.musicBars and
 * timeline.lengthenSlot; timeline's tools/reel-music.ts). The reel is in the template media store (REF1); its sound
 * is decoded with the bundled FFmpeg and measured by @taalcut/audio's bar finder, which reads the samples and runs
 * no model, on-device or cloud. A measurement is kept per reel file (its sha256) while the process lives: a make
 * reads it, tries a lengthening and applies it, on the same numbers.
 *
 * Null when this process has no template media store or no FFmpeg, the template keeps no reel, or the reel has no
 * sound: the tools then say there is no music to measure, and lengthen nothing.
 */
import { measureMusicFile, type MeasuredMusic } from '@taalcut/audio';
import { ok, TemplateMediaStoreToken, type AsyncResult, type Container } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { ReelMusicSource } from '@taalcut/timeline';

/** How many reels' measurements are kept (each holds the reel's sound as mono samples). */
const KEPT = 4;

export function reelMusicSource(
  container: Container,
  media: () => Promise<MediaContext | null>,
  measure: typeof measureMusicFile = measureMusicFile,
): ReelMusicSource {
  const measured = new Map<string, MeasuredMusic>();
  return async (templateId, signal): AsyncResult<MeasuredMusic | null> => {
    if (!container.has(TemplateMediaStoreToken)) return ok(null);
    const kept = await container.resolve(TemplateMediaStoreToken).get(templateId);
    if (!kept.ok) return kept;
    if (!kept.value || !kept.value.media.hasAudio) return ok(null);
    const key = kept.value.media.sha256;
    const known = measured.get(key);
    if (known) return ok(known);
    const context = await media();
    if (!context) return ok(null);
    const fresh = await measure(kept.value.path, context, signal ? { signal } : {});
    if (!fresh.ok) return fresh;
    measured.set(key, fresh.value);
    if (measured.size > KEPT) measured.delete(measured.keys().next().value as string);
    return ok(fresh.value);
  };
}
