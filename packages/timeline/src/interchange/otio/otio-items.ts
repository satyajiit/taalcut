// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OTIO 0.18.1 objects a timeline's items become (P2-M1, P3-V5): clips with their media reference, gaps and
 * (when the config allows) transitions. Rates are exact doubles, `num / den` computed the same way everywhere,
 * so 30000/1001 is always 29.97002997002997; values are whole frames wherever the time is on a frame. Speed
 * stays in metadata (NLEs don't round-trip LinearTimeWarp.1), so a ramped clip keeps its timeline length.
 */
import {
  FrameRate,
  type AssetId,
  type Clip,
  type RationalTime,
  type SequenceItem,
  type TimeRange,
  type TransitionItem,
} from '@taalcut/core';
import type { OtioJson, OtioMarker, OtioRationalTime, OtioTimeRange } from './schema';

export interface OtioMediaSource {
  /** What the clip links when the original is online: a `file://` URL or a POSIX path; null when offline. */
  readonly url: string | null;
  /** The original's file name, shown by the NLE. */
  readonly name: string | null;
  /** An offline original's last known path, kept in metadata so a person can relink by hand. */
  readonly lastKnown?: string | null;
}

export type ResolveMedia = (assetId: AssetId) => OtioMediaSource;

const rate = (value: FrameRate) => FrameRate.toNumber(value);
export const exactRate = (value: FrameRate) => ({ num: value.num, den: value.den });

export function rt(time: RationalTime): OtioRationalTime {
  return { OTIO_SCHEMA: 'RationalTime.1', rate: rate(time.rate), value: time.value };
}

/** `time` expressed at `to` as a double, exactly (no rounding to `to`'s frames). */
export function rtAt(time: RationalTime, to: FrameRate): OtioRationalTime {
  const value = (time.value * time.rate.den * to.num) / (time.rate.num * to.den);
  return { OTIO_SCHEMA: 'RationalTime.1', rate: rate(to), value };
}

export function range(start: OtioRationalTime, duration: OtioRationalTime): OtioTimeRange {
  return { OTIO_SCHEMA: 'TimeRange.1', duration, start_time: start };
}

export const timeRange = (value: TimeRange) => range(rt(value.start), rt(value.duration));
export const json = (time: RationalTime | null): OtioJson =>
  time ? { value: time.value, rate: exactRate(time.rate) } : null;

/** An original as OTIO links it: an ExternalReference when online, else a MissingReference keeping its last path. */
export function reference(source: OtioMediaSource, available: OtioTimeRange | null) {
  if (source.url)
    return {
      OTIO_SCHEMA: 'ExternalReference.1' as const,
      metadata: {},
      name: source.name,
      available_range: available,
      available_image_bounds: null,
      target_url: source.url,
    };
  return {
    OTIO_SCHEMA: 'MissingReference.1' as const,
    metadata: source.lastKnown ? { Taalcut: { lastKnownPath: source.lastKnown } } : {},
    name: source.name,
    available_range: available,
    available_image_bounds: null,
  };
}

function clipMetadata(clip: Clip) {
  return {
    clipId: clip.id,
    slotId: clip.slotId,
    assetId: clip.media.assetId,
    shotId: clip.media.kind === 'video' ? clip.media.shotId : null,
    mediaKind: clip.media.kind,
    sourceStart: json(clip.sourceStart),
    duration: json(clip.duration),
    syncPoint: json(clip.syncPoint),
    beatAnchor: clip.beatAnchor
      ? { beatIndex: clip.beatAnchor.beatIndex, offset: json(clip.beatAnchor.offset) }
      : null,
    ...(clip.holdFrame ? { holdFrame: json(clip.holdFrame) } : {}),
    speed: clip.speed
      ? {
          curve: clip.speed.curve,
          ...(clip.speed.windowStart ? { windowStart: json(clip.speed.windowStart) } : {}),
          points: clip.speed.points.map((point) => ({ at: json(point.at), speed: point.speed })),
        }
      : null,
    fit: clip.fit,
    gainDb: clip.audio.gainDb,
    muted: clip.audio.muted,
    locked: clip.locked,
    stillMotion: clip.stillMotion,
    reframe: clip.reframe,
  };
}

export function clipJson(clip: Clip, canvas: FrameRate, resolve: ResolveMedia) {
  const source = resolve(clip.media.assetId);
  const mediaRate = clip.media.kind === 'image' ? canvas : clip.media.available.start.rate;
  const available = clip.media.kind === 'image' ? null : timeRange(clip.media.available);
  const start = clip.media.kind === 'image' ? rtAt(clip.sourceStart, mediaRate) : rt(clip.sourceStart);
  return {
    OTIO_SCHEMA: 'Clip.2' as const,
    metadata: { Taalcut: clipMetadata(clip) },
    name: source.name,
    source_range: range(start, rtAt(clip.duration, mediaRate)),
    effects: clip.holdFrame
      ? [
          {
            OTIO_SCHEMA: 'FreezeFrame.1' as const,
            name: 'Hold frame',
            effect_name: 'FreezeFrame' as const,
            metadata: {},
            enabled: true,
            time_scalar: 0 as const,
          },
        ]
      : [],
    markers: [],
    enabled: clip.enabled,
    color: null,
    media_references: { DEFAULT_MEDIA: reference(source, available) },
    active_media_reference_key: 'DEFAULT_MEDIA',
  };
}

export function gapJson(id: string, slotId: string | null, duration: RationalTime) {
  return {
    OTIO_SCHEMA: 'Gap.1' as const,
    metadata: { Taalcut: { gapId: id, slotId } },
    name: null,
    source_range: range(rt({ value: 0, rate: duration.rate }), rt(duration)),
    effects: [],
    markers: [],
    enabled: true,
    color: null,
  };
}

export function transitionJson(item: TransitionItem) {
  const dissolve = item.kind === 'dissolve' || item.kind === 'fade';
  return {
    OTIO_SCHEMA: 'Transition.1' as const,
    metadata: { Taalcut: { transitionId: item.id, kind: item.kind, direction: item.direction } },
    name: item.kind,
    in_offset: rt(item.inOffset),
    out_offset: rt(item.outOffset),
    transition_type: dissolve ? ('SMPTE_Dissolve' as const) : ('Custom_Transition' as const),
  };
}

/** A track's children; transitions only when the writer is set to keep them (OTIO_CONFIG.transitions). */
type OtioChild = ReturnType<typeof clipJson> | ReturnType<typeof gapJson> | ReturnType<typeof transitionJson>;

export function children(
  items: readonly SequenceItem[],
  canvas: FrameRate,
  resolve: ResolveMedia,
  transitions: boolean,
): OtioChild[] {
  return items.flatMap((item): OtioChild[] => {
    if (item.type === 'clip') return [clipJson(item, canvas, resolve)];
    if (item.type === 'gap') return [gapJson(item.id, item.slotId, item.duration)];
    if (item.type === 'program') return [];
    return transitions ? [transitionJson(item)] : [];
  });
}

export function marker(
  name: string | null,
  color: OtioMarker['color'],
  marked: OtioTimeRange,
  comment: string,
  id: string,
): OtioMarker {
  return {
    OTIO_SCHEMA: 'Marker.2',
    metadata: { Taalcut: { id } },
    name,
    color,
    marked_range: marked,
    comment,
  };
}
