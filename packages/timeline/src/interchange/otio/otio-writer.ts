// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OpenTimelineIO export (P2-M1, P3-V5): Timeline → OTIO v0.18.1 JSON, checked against otioTimelineSchema before
 * anyone writes the `.otio` file. Resolve 18.5+ and Premiere 25.6+ read it. V1 and the audio tracks become
 * Track.1s, the user's own or generated music a 'Music' audio track under the whole video (music-track.ts); text,
 * captions, markers and (in v1) transitions are markers on the stack (stack-markers.ts), so every cut is a plain
 * cut in place.
 */
import { err, FrameRate, ok, ValidationError, type Result, type Timeline } from '@taalcut/core';
import { musicTrack } from './music-track';
import { children, exactRate, rt, type ResolveMedia } from './otio-items';
import { otioTimelineSchema, type OtioTimeline } from './schema';
import { stackMarkers } from './stack-markers';

export type { OtioMediaSource, ResolveMedia } from './otio-items';

/** Whether a transition is written as Transition.1 or as a cut plus a marker naming it. */
export const OTIO_TRANSITION_MODES = ['marker', 'transition'] as const;

export interface OtioOptions {
  /**
   * 'marker' until the manual Resolve check shows dissolves survive (SPEC, P3-V5); 'transition' writes
   * Transition.1, which overlaps the cut and takes no time either way.
   */
  readonly transitions?: (typeof OTIO_TRANSITION_MODES)[number];
  /** Written to metadata.Taalcut.writer. */
  readonly writer?: { readonly id: string; readonly version: string };
}

/** V1 and the audio tracks as Track.1s; text tracks are markers on the stack instead. */
function mediaTracks(timeline: Timeline, resolveMedia: ResolveMedia, keepTransitions: boolean) {
  const canvas = timeline.canvas.rate;
  return timeline.tracks.flatMap((track) => {
    if (track.kind === 'text') return [];
    return [
      {
        OTIO_SCHEMA: 'Track.1' as const,
        metadata: { Taalcut: { trackId: track.id, ...(track.kind === 'audio' ? { role: track.role } : {}) } },
        name: track.name || track.id,
        source_range: null,
        effects: [],
        markers: [],
        enabled: track.enabled,
        color: null,
        children: children(track.items, canvas, resolveMedia, keepTransitions),
        kind: track.kind === 'video' ? ('Video' as const) : ('Audio' as const),
      },
    ];
  });
}

/** What Taalcut keeps about the timeline in `metadata.Taalcut`: ids, the exact canvas and beat rates, the look. */
function timelineMetadata(timeline: Timeline, options: OtioOptions) {
  const canvas = timeline.canvas;
  const beatMap = timeline.beatMap;
  return {
    schemaVersion: timeline.schemaVersion,
    timelineId: timeline.id,
    projectId: timeline.projectId,
    revision: timeline.revision,
    canvas: { width: canvas.width, height: canvas.height, rate: exactRate(canvas.rate) },
    template: timeline.template ? { id: timeline.template.id, version: timeline.template.version } : null,
    beatMap: beatMap
      ? { rate: exactRate(beatMap.rate), beats: beatMap.beats.map((beat) => beat.value) }
      : null,
    music: timeline.music.path,
    styleId: timeline.styleId,
    ...(options.writer ? { writer: { id: options.writer.id, version: options.writer.version } } : {}),
  };
}

/** The document checked against the subset Taalcut writes: a failure is a writer bug, reported as core.validation. */
function checked(document: unknown): Result<OtioTimeline> {
  const parsed = otioTimelineSchema.safeParse(document);
  if (parsed.success) return ok(parsed.data);
  const detail = parsed.error.issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join('; ');
  return err(ValidationError({ field: 'otio' }, { detail }));
}

export function toOtio(
  timeline: Timeline,
  resolveMedia: ResolveMedia,
  options: OtioOptions = {},
): Result<OtioTimeline> {
  if (timeline.tracks.some((track) => track.kind === 'video' && track.items.some((item) => item.type === 'program')))
    return err(ValidationError({ field: 'otio' }, { detail: 'Render the authored program before exporting to another editor.' }));
  const keepTransitions = options.transitions === 'transition';
  return checked({
    OTIO_SCHEMA: 'Timeline.1' as const,
    metadata: { Taalcut: timelineMetadata(timeline, options) },
    name: timeline.name,
    global_start_time: rt({ value: 0, rate: timeline.canvas.rate }),
    tracks: {
      OTIO_SCHEMA: 'Stack.1' as const,
      metadata: {},
      name: 'tracks',
      source_range: null,
      effects: [],
      markers: stackMarkers(timeline, !keepTransitions),
      enabled: true,
      color: null,
      children: [
        ...mediaTracks(timeline, resolveMedia, keepTransitions),
        ...musicTrack(timeline, resolveMedia),
      ],
    },
  });
}

/** The `.otio` file's text: UTF-8 JSON (the extension is .otio, never .json). */
export function serializeOtio(otio: OtioTimeline): string {
  return `${JSON.stringify(otio, null, 2)}\n`;
}

/** The double OTIO stores for a rate; exported so tests can check no rate was rounded. */
export const otioRate = (value: FrameRate): number => FrameRate.toNumber(value);
