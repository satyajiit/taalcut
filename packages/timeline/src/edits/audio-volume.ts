// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * audio.setVolume (EDT1-OPS, SPEC "EDT1-OPS: sound"): the level, mute and fades of clips' sound or of the music. A
 * clip is any clip on V1 (its own sound) or on an audio track (a voice line, an effect); a group is every clip of
 * the video's own sound, the voice or the effects, where an agent passes over clips the person locked. Levels are
 * absolute (`gainDb`) or a change (`byDb`), clamped to −60…12 dB; fades are canvas frames from the ends, clamped to
 * the clip, zero taking one off. The music's level is its choice's `gainDb`; its mute and fades its bed's
 * (`mix.music`). Platform sound has no music to change (`timeline.invalid_move`).
 */
import {
  defaultMusicBed,
  err,
  ok,
  RationalTime,
  type AudioTarget,
  type Clip,
  type ClipAudio,
  type Result,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { InvalidMove, ItemNotFound } from '../errors';
import { refuseLocked, type EditOptions, type EditResult } from './types';
import type { TimelinePart } from './types';

export interface VolumeInput {
  readonly target: AudioTarget;
  readonly gainDb?: number | undefined;
  readonly byDb?: number | undefined;
  readonly muted?: boolean | undefined;
  readonly fadeIn?: RationalTime | undefined;
  readonly fadeOut?: RationalTime | undefined;
}

const clampDb = (value: number) => Math.min(12, Math.max(-60, Math.round(value * 10) / 10));

function level(current: number, input: VolumeInput): number {
  if (input.gainDb !== undefined) return clampDb(input.gainDb);
  if (input.byDb !== undefined) return clampDb(current + input.byDb);
  return current;
}

/** A fade in canvas frames inside `length`; null takes it off; undefined leaves it. */
function fadeFrames(fade: RationalTime | undefined, length: number, rate: Timeline['canvas']['rate']) {
  if (fade === undefined) return undefined;
  const frames = Math.min(length, Math.max(0, RationalTime.rescale(fade, rate, 'round').value));
  return frames === 0 ? null : RationalTime.of(frames, rate);
}

function withFade(
  audio: ClipAudio,
  edge: 'fadeIn' | 'fadeOut',
  fade: RationalTime | null | undefined,
): ClipAudio {
  if (fade === undefined) return audio;
  const { [edge]: _old, ...rest } = audio;
  return fade === null ? rest : { ...rest, [edge]: fade };
}

function clipSound(clip: Clip, input: VolumeInput, rate: Timeline['canvas']['rate']): Clip {
  let audio: ClipAudio = { ...clip.audio, gainDb: level(clip.audio.gainDb, input) };
  if (input.muted !== undefined) audio = { ...audio, muted: input.muted };
  audio = withFade(audio, 'fadeIn', fadeFrames(input.fadeIn, clip.duration.value, rate));
  audio = withFade(audio, 'fadeOut', fadeFrames(input.fadeOut, clip.duration.value, rate));
  return { ...clip, audio };
}

/** Whether a clip on `track` is in the target, and whether a lock on it refuses (true) or skips (false) an agent. */
function inTarget(target: AudioTarget, track: Track, clip: Clip): 'named' | 'group' | null {
  if (target.kind === 'clips') return target.clipIds.includes(clip.id) ? 'named' : null;
  if (target.kind !== 'all') return null;
  const role = track.kind === 'video' ? 'clip' : track.kind === 'audio' ? track.role : null;
  const group = role === 'clip' ? 'clips' : role;
  return group === target.group ? 'group' : null;
}

function clipsVolume(timeline: Timeline, input: VolumeInput, options: EditOptions): Result<EditResult> {
  const rate = timeline.canvas.rate;
  const found = new Set<string>();
  const tracks: Track[] = [];
  for (const track of timeline.tracks) {
    if (track.kind === 'text') {
      tracks.push(track);
      continue;
    }
    const items = [];
    for (const item of track.items) {
      const how =
        item.type === 'clip' && item.media.kind !== 'image' ? inTarget(input.target, track, item) : null;
      if (item.type !== 'clip' || !how) {
        items.push(item);
        continue;
      }
      const locked = refuseLocked(item, options.source);
      if (!locked.ok && how === 'named') return locked;
      found.add(item.id);
      items.push(locked.ok ? clipSound(item, input, rate) : item);
    }
    tracks.push({ ...track, items } as Track);
  }
  if (input.target.kind === 'clips') {
    const missing = input.target.clipIds.find((id) => !found.has(id));
    if (missing) return err(ItemNotFound({ itemId: missing }));
  } else if (found.size === 0) return err(InvalidMove(undefined, { detail: 'This video has no such sound' }));
  const changed = JSON.stringify(tracks) !== JSON.stringify(timeline.tracks);
  return ok(changed ? { timeline: { ...timeline, tracks }, changed: ['tracks'] } : { timeline, changed: [] });
}

function musicVolume(timeline: Timeline, input: VolumeInput): Result<EditResult> {
  const music = timeline.music;
  if (music.path === 'platformSound' || music.path === 'none')
    return err(InvalidMove(undefined, { detail: 'This timeline has no music bed to edit' }));
  const rate = timeline.canvas.rate;
  const changed: TimelinePart[] = [];
  let next: Timeline = timeline;
  const gainDb = level(music.gainDb, input);
  if (gainDb !== music.gainDb) {
    next = { ...next, music: { ...music, gainDb } };
    changed.push('music');
  }
  const bed = timeline.mix.music ?? defaultMusicBed(rate);
  const fade = (value: RationalTime | undefined, current: RationalTime) => {
    if (value === undefined) return current;
    return RationalTime.of(Math.max(0, RationalTime.rescale(value, rate, 'round').value), rate);
  };
  const nextBed = {
    ...bed,
    muted: input.muted ?? bed.muted,
    fadeIn: fade(input.fadeIn, bed.fadeIn),
    fadeOut: fade(input.fadeOut, bed.fadeOut),
  };
  if (JSON.stringify(nextBed) !== JSON.stringify(bed)) {
    next = { ...next, mix: { ...next.mix, music: nextBed } };
    changed.push('mix');
  }
  return ok({ timeline: next, changed });
}

export function setVolume(timeline: Timeline, input: VolumeInput, options: EditOptions): Result<EditResult> {
  return input.target.kind === 'music' ? musicVolume(timeline, input) : clipsVolume(timeline, input, options);
}
