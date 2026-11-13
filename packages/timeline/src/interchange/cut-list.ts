// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frame-exact edit list every pro export writer is checked against (P3-V5): V1's clips and gaps, the clips
 * of the audio tracks and the music bed, each with its place on the timeline in canvas frames and its in-point
 * as exact seconds. A writer's file is read back to a cut list; any difference from the timeline's is a bug.
 */
import type { RationalTime, Timeline } from '@taalcut/core';
import { positions, sequenceLength, videoItems } from '../model/sequence';
import { secondsKey, timeToSeconds } from './seconds';

export interface CutEntry {
  /** 'V1', an audio track's id ('A1'…), or 'music' for the bed under the whole video. */
  readonly track: string;
  readonly kind: 'clip' | 'gap';
  /** Where it starts on the timeline and how long it lasts, in canvas frames. */
  readonly start: number;
  readonly frames: number;
  readonly assetId: string | null;
  /** The source instant at its start as reduced exact seconds, 'n/d'; null for a gap. */
  readonly inPoint: string | null;
}

export type CutList = readonly CutEntry[];

/** The music bed's track in a cut list. */
export const MUSIC_TRACK = 'music';

/** A time as exact seconds, 'n/d'. */
export const exactSeconds = (time: RationalTime): string => secondsKey(timeToSeconds(time));

/** What the timeline means: the list every writer's file must read back to. */
export function cutList(timeline: Timeline): CutList {
  const out: CutEntry[] = [];
  for (const track of timeline.tracks) {
    if (track.kind === 'text') continue;
    for (const { item, start, end } of positions(track.items)) {
      if (item.type === 'program') continue;
      if (item.type === 'gap') {
        if (track.kind === 'video')
          out.push({
            track: track.id,
            kind: 'gap',
            start,
            frames: end - start,
            assetId: null,
            inPoint: null,
          });
        continue;
      }
      out.push({
        track: track.id,
        kind: 'clip',
        start,
        frames: end - start,
        assetId: item.media.assetId,
        inPoint: exactSeconds(item.sourceStart),
      });
    }
  }
  const bed = musicBed(timeline);
  if (bed) out.push(bed);
  return out;
}

/** The music the video plays under its whole length, when it is the user's own or generated track. */
export function musicBed(timeline: Timeline): CutEntry | null {
  const frames = sequenceLength(videoItems(timeline));
  const music = timeline.music;
  if (frames < 1) return null;
  if (music.path === 'ownTrack')
    return {
      track: MUSIC_TRACK,
      kind: 'clip',
      start: 0,
      frames,
      assetId: music.assetId,
      inPoint: exactSeconds(music.offset),
    };
  if (music.path === 'generated')
    return { track: MUSIC_TRACK, kind: 'clip', start: 0, frames, assetId: music.assetId, inPoint: '0/1' };
  return null;
}

const describe = (entry: CutEntry | undefined) =>
  entry
    ? `${entry.track} ${entry.kind} @${entry.start}+${entry.frames} ${entry.assetId ?? '-'} in ${entry.inPoint ?? '-'}`
    : 'nothing';

const order = (a: CutEntry, b: CutEntry) =>
  a.track < b.track ? -1 : a.track > b.track ? 1 : a.start - b.start || a.frames - b.frames;

/**
 * Where two cut lists disagree, as plain lines (empty when they match). A cut more than `toleranceFrames` away
 * is a difference; in-points and assets must match exactly.
 */
export function cutDifferences(expected: CutList, actual: CutList, toleranceFrames = 0): string[] {
  const want = [...expected].sort(order);
  const got = [...actual].sort(order);
  const out: string[] = [];
  for (let index = 0; index < Math.max(want.length, got.length); index++) {
    const a = want[index];
    const b = got[index];
    const same =
      a !== undefined &&
      b !== undefined &&
      a.track === b.track &&
      a.kind === b.kind &&
      a.assetId === b.assetId &&
      a.inPoint === b.inPoint &&
      Math.abs(a.start - b.start) <= toleranceFrames &&
      Math.abs(a.start + a.frames - (b.start + b.frames)) <= toleranceFrames;
    if (!same) out.push(`expected ${describe(a)}, read ${describe(b)}`);
  }
  return out;
}
