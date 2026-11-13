// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A music choice and the beats the cuts follow (render SPEC 8, REF1), shared by `music.choosePath` and the variants'
 * music axis so both set it the same way:
 * - an own track (path b): its tracked beats placed under the timeline, when it has a beat map;
 * - the reel's own music (path d): the template version's beat map, because the reel's audio starts at frame 0 where
 *   that map's zero is. Only an earlier choice (an own track) can have moved the grid; the cuts then go back to the
 *   reel's beats, so the music and the cuts share one clock again;
 * - platform sound and generated music: the cuts stay where they are.
 */
import { isDeepStrictEqual } from 'node:util';
import {
  ok,
  type AssetId,
  type AsyncResult,
  type BeatMap,
  type MusicChoice,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { TemplateNotFound } from '../errors';
import type { EditConfig } from '../model/config';
import type { TemplateReader } from '../service/templates';
import { beatsUnderTimeline, resyncToBeatMap } from './resync';

export interface MusicBeatDeps {
  /** An own track's beat map in the track's time; null when it has none. Absent: the cuts stay. */
  readonly trackBeats?: (assetId: AssetId, signal?: AbortSignal) => AsyncResult<BeatMap | null>;
  /** The template versions, for the reel's beat map. Absent: the cuts stay. */
  readonly templates?: TemplateReader;
  readonly config?: EditConfig;
  readonly ids?: () => TimelineItemId;
  readonly signal?: AbortSignal;
}

export interface WithMusic {
  readonly timeline: Timeline;
  /** The cuts moved to another grid: the tracks, markers and beat map changed with the music. */
  readonly retimed: boolean;
}

/** The grid `choice` brings, or null when the cuts stay where they are. */
async function gridFor(
  timeline: Timeline,
  choice: MusicChoice,
  deps: MusicBeatDeps,
): AsyncResult<BeatMap | null> {
  if (choice.path === 'ownTrack') {
    if (!deps.trackBeats) return ok(null);
    const beats = await deps.trackBeats(choice.assetId, deps.signal);
    if (!beats.ok) return beats;
    return ok(beats.value ? beatsUnderTimeline(beats.value, choice.offset) : null);
  }
  if (choice.path !== 'referenceAudio' || !deps.templates || !timeline.template) return ok(null);
  const template = await deps.templates.read(timeline.template);
  // A template that is gone has no reel either: the choice stands, and the export says what is missing.
  if (!template.ok) return TemplateNotFound.is(template.error) ? ok(null) : template;
  const reel = template.value.beatMap;
  return ok(reel && !isDeepStrictEqual(reel, timeline.beatMap) ? reel : null);
}

/** `timeline` with `choice` as its music, its cuts on that music's beats when it brings a grid of its own. */
export async function withMusic(
  timeline: Timeline,
  choice: MusicChoice,
  deps: MusicBeatDeps,
): AsyncResult<WithMusic> {
  const next: Timeline = { ...timeline, music: choice };
  const grid = await gridFor(timeline, choice, deps);
  if (!grid.ok) return grid;
  if (!grid.value) return ok({ timeline: next, retimed: false });
  return ok({
    timeline: resyncToBeatMap(next, grid.value, {
      ...(deps.config ? { config: deps.config } : {}),
      ...(deps.ids ? { ids: deps.ids } : {}),
    }),
    retimed: true,
  });
}
