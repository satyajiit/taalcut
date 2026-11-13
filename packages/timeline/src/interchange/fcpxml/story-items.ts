// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What hangs off the spine in FCPXML (P3-V5): markers (text, Taalcut's markers and, in v1, transitions written
 * as a cut plus a marker naming them) and the audio connected below it (music on lane −1, audio track An on lane
 * −(n+1), as audio-only asset clips with their role). Each sits in the spine item its start falls in, in that
 * item's local time; markers can't sit in the spine itself.
 */
import { RationalTime, type AssetId, type Timeline } from '@taalcut/core';
import { MARKER_TEXT } from '../../model/markers';
import { positions, sequenceLength, videoItems } from '../../model/sequence';
import { musicBed } from '../cut-list';
import { timeToSeconds, type Seconds } from '../seconds';

export interface TimedMarker {
  /** Canvas frame. */
  readonly at: number;
  readonly value: string;
  readonly note: string;
}

export interface ConnectedAudio {
  /** Canvas frame where it starts, and its length. */
  readonly at: number;
  readonly frames: number;
  readonly assetId: AssetId;
  readonly inPoint: Seconds;
  readonly lane: number;
  readonly role: 'music' | 'dialogue' | 'effects';
  readonly gainDb: number;
  readonly enabled: boolean;
}

/** The music bed's lane; audio track `An` is on lane −(n + 1). */
export const MUSIC_LANE = -1;
export const laneOfTrack = (trackId: string): number => -(Number(trackId.slice(1)) + 1);
export const trackOfLane = (lane: number): string => (lane === MUSIC_LANE ? 'music' : `A${-lane - 1}`);

export function timedMarkers(timeline: Timeline, transitionsAsMarkers: boolean): TimedMarker[] {
  const rate = timeline.canvas.rate;
  const frame = (time: RationalTime) => RationalTime.rescale(time, rate, 'round').value;
  const out: TimedMarker[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'text') continue;
    for (const item of track.items)
      if (item.type === 'text')
        out.push({ at: frame(item.start), value: item.text, note: `Text: ${item.role}` });
  }
  for (const marker of timeline.markers)
    out.push({
      at: frame(marker.range.start),
      value: MARKER_TEXT[marker.label] ?? marker.label,
      note: marker.kind,
    });
  if (transitionsAsMarkers) {
    const items = videoItems(timeline);
    const starts = new Map(positions(items).map((position) => [position.itemIndex, position.start]));
    items.forEach((item, index) => {
      if (item.type === 'transition')
        out.push({
          at: starts.get(index + 1) ?? sequenceLength(items),
          value: `Transition: ${item.kind}`,
          note: 'transition',
        });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

const ROLES = { clip: 'dialogue', voice: 'dialogue', sfx: 'effects' } as const;

export function connectedAudio(timeline: Timeline): ConnectedAudio[] {
  const out: ConnectedAudio[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'audio') continue;
    for (const { item, start, end } of positions(track.items)) {
      if (item.type !== 'clip') continue;
      out.push({
        at: start,
        frames: end - start,
        assetId: item.media.assetId,
        inPoint: timeToSeconds(item.sourceStart),
        lane: laneOfTrack(track.id),
        role: ROLES[track.role],
        gainDb: item.audio.gainDb,
        enabled: item.enabled && !item.audio.muted && track.enabled,
      });
    }
  }
  const bed = musicBed(timeline);
  const music = timeline.music;
  if (bed && (music.path === 'ownTrack' || music.path === 'generated'))
    out.push({
      at: 0,
      frames: bed.frames,
      assetId: music.assetId,
      inPoint: music.path === 'ownTrack' ? timeToSeconds(music.offset) : { num: 0n, den: 1n },
      lane: MUSIC_LANE,
      role: 'music',
      gainDb: music.gainDb,
      enabled: true,
    });
  return out;
}
