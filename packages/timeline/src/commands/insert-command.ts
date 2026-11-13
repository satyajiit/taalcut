// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.insertClip's half that reads the library (EDT1-OPS): the shot's profile, its length, and its in-point:
 * the caller's (with the sync point under it), else the in-point rule's for the place it goes (a motion peak on the
 * beat), else the shot's start. A photo needs no profile. The clip's sound and fit follow the clip before it (a made
 * video's clips are muted under the music), and a video whose shape differs from the canvas follows its subject.
 */
import {
  err,
  RationalTime,
  type AsyncResult,
  type Clip,
  type editorCommandPayloads,
  type EDITOR_COMMANDS,
  type MediaRef,
  type ShotProfile,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import type { z } from 'zod';
import { CASTING_CONFIG } from '../casting/config';
import { selectInPoint } from '../casting/in-points';
import { mediaRef, syncPointAt } from '../casting/result';
import { orientationOf } from '../casting/slots';
import { insertionPoint, placeClip, type PlacedResult } from '../edits/insert';
import type { EditOptions } from '../edits/types';
import { InvalidMove, MediaTooShort } from '../errors';
import { candidateKey } from '../model/cast';
import { medianItemFrames, positions, sequenceLength, videoItems, type Position } from '../model/sequence';
import { clipMediaFits } from '../model/speed';
import type { CommandDeps } from './context';
import { positionSpec, profilesFor } from './resolve';

type InsertPayload = z.output<(typeof editorCommandPayloads)[typeof EDITOR_COMMANDS.insertClip]>;
type Options = EditOptions & { readonly ids: () => TimelineItemId };

/** The clip as the neighbour before it plays: its sound's mute and its fit. */
function neighbourOf(timeline: Timeline, boundary: number): Pick<Clip, 'audio' | 'fit'> {
  const all = positions(videoItems(timeline));
  const near = [all[boundary - 1], all[boundary]].find((entry) => entry?.item.type === 'clip')?.item;
  return near?.type === 'clip' ? { audio: { gainDb: 0, muted: near.audio.muted }, fit: near.fit } : { audio: { gainDb: 0, muted: true }, fit: 'cover' };
}

function baseClip(id: TimelineItemId, media: MediaRef, frames: number, timeline: Timeline, boundary: number): Clip {
  const rate = timeline.canvas.rate;
  return {
    type: 'clip',
    id,
    media,
    sourceStart: RationalTime.zero(rate),
    duration: RationalTime.of(frames, rate),
    speed: null,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    ...neighbourOf(timeline, boundary),
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

/** The video clip: its in-point and sync point, and a length the media can fill from there. */
function videoClip(base: Clip, profile: ShotProfile, at: Position, payload: InsertPayload, timeline: Timeline, hook: boolean): Clip | null {
  const rate = timeline.canvas.rate;
  const spec = positionSpec(timeline, at);
  const media = payload.media.kind === 'video' ? payload.media : null;
  // An in-point at any rate lands on the nearest media frame.
  const asked = media?.sourceStart ? RationalTime.rescale(media.sourceStart, profile.range.start.rate, 'round') : null;
  const point = asked
    ? { sourceStart: asked, syncPoint: syncPointAt(profile, spec, asked, rate, CASTING_CONFIG) }
    : (selectInPoint(profile, spec, rate, CASTING_CONFIG, hook) ?? { sourceStart: profile.range.start, syncPoint: null });
  const differs = profile.orientation !== orientationOf(timeline.canvas);
  let clip: Clip = {
    ...base,
    sourceStart: point.sourceStart,
    syncPoint: point.syncPoint,
    reframe: differs ? { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 } : null,
  };
  // An unasked length is cut to what the media has left; an asked one must fit.
  if (!payload.duration) {
    const left = RationalTime.rescale(
      RationalTime.subtract(RationalTime.add(profile.range.start, profile.range.duration), point.sourceStart),
      rate,
      'floor',
    ).value;
    clip = { ...clip, duration: RationalTime.of(Math.max(1, Math.min(clip.duration.value, left)), rate) };
  }
  return clipMediaFits(clip, rate) ? clip : null;
}

export async function insertWith(
  deps: CommandDeps,
  timeline: Timeline,
  payload: InsertPayload,
  options: Options,
): AsyncResult<PlacedResult> {
  const rate = timeline.canvas.rate;
  const frames = payload.duration
    ? RationalTime.rescale(payload.duration, rate, 'round').value
    : Math.round(medianItemFrames(videoItems(timeline)));
  if (frames < 1) return err(InvalidMove(undefined, { detail: 'A clip lasts at least a frame' }));
  const point = insertionPoint(timeline, payload.position, options);
  if (!point.ok) return point;
  const { timeline: opened, boundary } = point.value;
  const id = options.ids();
  const start = positions(videoItems(opened))[boundary]?.start ?? sequenceLength(videoItems(opened));
  if (payload.media.kind === 'image') {
    const base = baseClip(id, { kind: 'image', assetId: payload.media.assetId }, frames, opened, boundary);
    return placeClip(opened, { ...base, stillMotion: payload.media.stillMotion }, boundary, options);
  }
  const ref = { assetId: payload.media.assetId, shotId: payload.media.shotId };
  const profiles = await profilesFor(deps.catalog, [ref]);
  if (!profiles.ok) return profiles;
  const profile = profiles.value.get(candidateKey(ref)) as ShotProfile;
  const base = baseClip(id, mediaRef(profile), frames, opened, boundary);
  const at: Position = { itemIndex: -1, item: { type: 'gap', id, duration: base.duration, slotId: null }, start, end: start + frames };
  const clip = videoClip(base, profile, at, payload, opened, boundary === 0);
  if (!clip) return err(MediaTooShort({ clipId: id }));
  return placeClip(opened, clip, boundary, options);
}
