// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: `timeline.slipClip` as the fake runs it, kept small: a clip plays another part of the same shot, by a
 * time or to an in-point; its place, length and speed stay, and its cast slot's pick follows, marked the person's
 * own. Inside the clip's shot (or as far outside it as the clip already is), else a refusal, as the timeline
 * package's command. `avoid` needs what the fake has none of (the shot's faces), so it is refused. With
 * `clipPart: 'samples'` in `taalcut.fake`, Golden hour's first video plays the sample clips, which have real
 * filmstrips and copies to play, so the Trim tool can be seen whole in a browser.
 */
import {
  defineCommand,
  EDITOR_COMMANDS,
  editorCommandPayloads,
  RationalTime,
  type AnyCommand,
  type Clip,
  type CommandSource,
  type ProjectId,
  type TimeRange,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { timelineError, type Edit } from './edits';
import type { FakeTimelines } from './fake-timelines';
import { KIND } from '../library/assets';
import { fakeUlid } from '../library/seed';
import { centredStart, fileShot, fileShots, type PoolShot } from './shot-pool';

const P = editorCommandPayloads;

export function slipClip(
  timeline: Timeline,
  input: {
    clipId: TimelineItemId;
    by?: RationalTime | undefined;
    sourceStart?: RationalTime | undefined;
    avoid?: readonly string[] | undefined;
  },
  shotOf: (clip: Clip) => TimeRange | undefined,
  source: CommandSource,
): Edit {
  const items = timeline.tracks[0]?.kind === 'video' ? timeline.tracks[0].items : [];
  const clip = items.find((item) => item.type === 'clip' && item.id === input.clipId);
  if (!clip || clip.type !== 'clip')
    return { ok: false, error: timelineError('timeline.item_not_found', { itemId: input.clipId }) };
  if (clip.locked && source === 'agent')
    return { ok: false, error: timelineError('timeline.clip_locked', { clipId: clip.id }) };
  const refused: Edit = { ok: false, error: timelineError('timeline.invalid_move') };
  if (clip.media.kind !== 'video' || input.avoid) return refused;
  const rate = clip.sourceStart.rate;
  const shot = shotOf(clip) ?? clip.media.available;
  const first = RationalTime.rescale(shot.start, rate, 'round').value;
  const length = RationalTime.rescale(shot.duration, rate, 'round').value;
  const needs = RationalTime.rescale(clip.duration, rate, 'ceil').value;
  const current = clip.sourceStart.value - first;
  const asked = input.sourceStart
    ? RationalTime.rescale(input.sourceStart, rate, 'round').value - first
    : current + RationalTime.rescale(input.by ?? RationalTime.zero(rate), rate, 'round').value;
  if (asked < Math.min(0, current) || asked > Math.max(length - needs, current)) return refused;
  if (asked === current) return { ok: true, timeline };
  const sourceStart = RationalTime.of(first + asked, rate);
  const last = RationalTime.add(clip.media.available.start, clip.media.available.duration);
  if (RationalTime.compare(RationalTime.add(sourceStart, RationalTime.of(needs, rate)), last) > 0)
    return { ok: false, error: timelineError('timeline.media_too_short', { clipId: clip.id }) };
  return {
    ok: true,
    timeline: {
      ...timeline,
      tracks: timeline.tracks.map((track, index) =>
        index === 0 && track.kind === 'video'
          ? {
              ...track,
              items: track.items.map((item) =>
                item.type === 'clip' && item.id === clip.id
                  ? { ...item, sourceStart, syncPoint: null }
                  : item,
              ),
            }
          : track,
      ),
      cast: timeline.cast && {
        ...timeline.cast,
        slots: timeline.cast.slots.map((slot) =>
          slot.clipId === clip.id && slot.pick
            ? {
                ...slot,
                pick: { ...slot.pick, sourceStart, syncPoint: null },
                ...(source === 'agent' ? {} : { note: 'userPick' as const }),
              }
            : slot,
        ),
      },
    },
  };
}

export function createFakePart(
  timelines: FakeTimelines,
  shots: ReadonlyMap<string, PoolShot>,
  libraryCount?: number,
): AnyCommand[] {
  const shotOf = (clip: Clip) => {
    if (clip.media.kind !== 'video' || !clip.media.shotId) return undefined;
    return (
      shots.get(clip.media.shotId)?.shot ??
      fileShot(clip.media.assetId, clip.media.shotId, libraryCount)?.shot
    );
  };
  return [
    defineCommand({
      sideEffect: 'write' as const,
      project: (p: { projectId: ProjectId }) => p.projectId,
      name: EDITOR_COMMANDS.slipClip,
      payload: P[EDITOR_COMMANDS.slipClip],
      handle: (p, context) => timelines.edit(p, (timeline) => slipClip(timeline, p, shotOf, context.source)),
    }),
  ];
}

/** The sample clips Golden hour's first scenes play with `clipPart: 'samples'`, by their asset number. */
const SAMPLE_SCENES = [90_104, 90_103, 90_101, 90_102, 90_108, 90_106] as const;

/**
 * `timeline` with its first scenes playing the sample clips (each from the first of its shots that is long
 * enough), so their files' filmstrips and copies to play show in the Trim tool.
 */
export function withSampleParts(timeline: Timeline): Timeline {
  const picks = new Map<TimelineItemId, PoolShot>();
  let scene = 0;
  const tracks = timeline.tracks.map((track, index) =>
    index !== 0 || track.kind !== 'video'
      ? track
      : {
          ...track,
          items: track.items.map((item) => {
            if (item.type !== 'clip') return item;
            const n = SAMPLE_SCENES[scene];
            scene += 1;
            if (n === undefined || item.media.kind !== 'video') return item;
            const rate = timeline.canvas.rate;
            const frames = item.duration.value;
            // The sample's shots, in order: the first one the scene fits in.
            const found = fileShots(fakeUlid<'Asset'>(KIND.asset, n)).find(
              (shot) => RationalTime.rescale(shot.shot.duration, rate, 'floor').value >= frames,
            );
            if (!found) return item;
            picks.set(item.id, found);
            return {
              ...item,
              media: {
                kind: 'video' as const,
                assetId: found.candidate.assetId,
                shotId: found.candidate.shotId,
                available: found.available,
              },
              sourceStart: centredStart(found, frames, rate),
              syncPoint: null,
            };
          }),
        },
  );
  const video = tracks[0];
  const clips = video?.kind === 'video' ? video.items : [];
  return {
    ...timeline,
    tracks,
    cast: timeline.cast && {
      ...timeline.cast,
      slots: timeline.cast.slots.map((slot) => {
        const pick = slot.clipId ? picks.get(slot.clipId) : undefined;
        const clip = clips.find((item) => item.type === 'clip' && item.id === slot.clipId);
        return pick && clip?.type === 'clip'
          ? { ...slot, pick: { ...pick.candidate, sourceStart: clip.sourceStart } }
          : slot;
      }),
    },
  };
}
