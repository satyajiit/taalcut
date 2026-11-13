// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: colour, markers and the sound (level, mute, fades, trims and moves) on core's bus. */
import {
  AUDIO_EDIT_COMMANDS,
  EDITOR_COMMANDS,
  newId,
  RationalTime,
  TimeRange,
  type Clip,
  type SequenceItem,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { positions } from '../../src/model/sequence';
import { clipById } from '../fixtures/timeline';
import { agentOrigin, editorWorld, f } from './editor-world';

const three = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30, locked: true }] };

/** A voice line on A2 from `start` for `frames`. */
function line(start: number, frames: number): { start: number; clip: Clip } {
  const rate = { num: 30, den: 1 };
  return {
    start,
    clip: {
      type: 'clip',
      id: newId<'TimelineItem'>(),
      media: { kind: 'audio', assetId: newId<'Asset'>(), available: TimeRange.of(f(0), f(90)) },
      sourceStart: RationalTime.of(10, rate),
      duration: RationalTime.of(frames, rate),
      speed: null,
      slotId: null,
      syncPoint: null,
      beatAnchor: null,
      fit: 'cover',
      audio: { gainDb: -3, muted: false },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    },
  };
}

/** The world with a voice track of two lines and the user's own track as music. */
async function soundWorld() {
  const lines = [line(10, 20), line(40, 20)];
  const items: SequenceItem[] = [];
  let cursor = 0;
  for (const { start, clip } of lines) {
    if (start > cursor) items.push({ type: 'gap', id: newId<'TimelineItem'>(), duration: f(start - cursor), slotId: null });
    items.push(clip);
    cursor = start + clip.duration.value;
  }
  const voice: Track = { kind: 'audio', id: 'A2', name: 'Voice', enabled: true, role: 'voice', items };
  const music = { path: 'ownTrack' as const, assetId: newId<'Asset'>(), offset: f(0), gainDb: -6 };
  const world = await editorWorld(three, undefined, (timeline) => ({ ...timeline, tracks: [...timeline.tracks, voice], music }));
  return { ...world, lines: lines.map((entry) => entry.clip.id) };
}

const voiceStarts = (timeline: Timeline) => {
  const track = timeline.tracks.find((t) => t.kind === 'audio' && t.role === 'voice');
  return track && track.kind !== 'text'
    ? positions(track.items).flatMap(({ item, start }) => (item.type === 'clip' ? [[start, item.duration.value]] : []))
    : [];
};

describe('timeline.setGrade', () => {
  it('merges into a clip’s grade, takes it off with null, and keeps the person’s locks', async () => {
    const world = await editorWorld(three);
    const [first, , locked] = world.built.ids;
    await world.run(EDITOR_COMMANDS.setGrade, { target: { kind: 'clips', clipIds: [first] }, grade: { temperature: 0.3 } });
    await world.run(EDITOR_COMMANDS.setGrade, { target: { kind: 'clips', clipIds: [first] }, grade: { exposure: 0.5, look: 'warm' } });
    expect(clipById(world.doc(), first as string).grade).toMatchObject({ temperature: 0.3, exposure: 0.5, look: 'warm', lookStrength: 1 });
    await world.run(EDITOR_COMMANDS.setGrade, { target: { kind: 'clips', clipIds: [first] }, grade: null });
    expect(clipById(world.doc(), first as string).grade).toBeUndefined();
    const refused = await world.run(EDITOR_COMMANDS.setGrade, { target: { kind: 'clips', clipIds: [locked] }, grade: { contrast: 0.2 } }, agentOrigin);
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
  });

  it('grades the whole video, stores a neutral grade as none, and undoes it in one step', async () => {
    const world = await editorWorld(three);
    await world.run(EDITOR_COMMANDS.setGrade, { target: { kind: 'timeline' }, grade: { look: 'mono', saturation: -0.2 } });
    expect(world.doc().grade).toMatchObject({ look: 'mono', saturation: -0.2 });
    await world.undo();
    expect(world.doc().grade).toBeUndefined();
    await world.redo();
    await world.run(EDITOR_COMMANDS.setGrade, { target: { kind: 'timeline' }, grade: { look: null, saturation: 0 } });
    expect(world.doc().grade).toBeUndefined();
  });
});

describe('timeline.addMarker', () => {
  it('adds a note in the kind’s colour inside the video, and undo takes it off', async () => {
    const world = await editorWorld(three);
    const added = await world.run(EDITOR_COMMANDS.addMarker, { at: f(15), label: 'Tighten this' });
    const id = added.ok ? (added.value as { itemId: string }).itemId : '';
    expect(world.doc().markers).toMatchObject([{ id, kind: 'note', colour: 'GREEN', label: 'Tighten this' }]);
    const outside = await world.run(EDITOR_COMMANDS.addMarker, { at: f(400) });
    expect(!outside.ok && outside.error.code).toBe('timeline.invalid_move');
    await world.undo();
    expect(world.doc().markers).toEqual([]);
  });
});

describe('audio.setVolume', () => {
  it('sets a clip’s level and fades, a change to it, and takes a fade off with zero', async () => {
    const world = await soundWorld();
    const [first] = world.built.ids;
    await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'clips', clipIds: [first] }, gainDb: -4, fadeIn: f(6), fadeOut: f(90) });
    expect(clipById(world.doc(), first as string).audio).toEqual({ gainDb: -4, muted: true, fadeIn: f(6), fadeOut: f(30) });
    await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'clips', clipIds: [first] }, byDb: -70, fadeIn: f(0) });
    expect(clipById(world.doc(), first as string).audio).toEqual({ gainDb: -60, muted: true, fadeOut: f(30) });
  });

  it('takes a whole group, passing over what the person locked for an agent', async () => {
    const world = await soundWorld();
    const [, , locked] = world.built.ids;
    await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'all', group: 'voice' }, byDb: -3 });
    const voice = world.doc().tracks.find((t) => t.kind === 'audio' && t.role === 'voice');
    expect(voice?.kind === 'audio' && voice.items.flatMap((item) => (item.type === 'clip' ? [item.audio.gainDb] : []))).toEqual([-6, -6]);
    await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'all', group: 'clips' }, muted: false }, agentOrigin);
    expect(clipById(world.doc(), world.built.ids[0] as string).audio.muted).toBe(false);
    expect(clipById(world.doc(), locked as string).audio.muted).toBe(true);
    const none = await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'all', group: 'sfx' }, muted: true });
    expect(!none.ok && none.error.code).toBe('timeline.invalid_move');
  });

  it('the music’s level is its choice’s, its mute and fades its bed’s; platform sound has none', async () => {
    const world = await soundWorld();
    await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'music' }, byDb: -4, fadeOut: f(20), muted: true });
    expect(world.doc().music).toMatchObject({ path: 'ownTrack', gainDb: -10 });
    expect(world.doc().mix.music).toMatchObject({ fadeOut: f(20), muted: true, start: f(0), end: null });
    await world.undo();
    expect([world.doc().music, world.doc().mix.music]).toMatchObject([{ gainDb: -6 }, undefined]);
    const plain = await editorWorld(three);
    const refused = await plain.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'music' }, gainDb: 0 });
    expect(!refused.ok && refused.error.code).toBe('timeline.invalid_move');
  });
});

describe('audio.trim and audio.move', () => {
  it('a voice line moves and trims within the room either side, its in-point following a start trim', async () => {
    const world = await soundWorld();
    const [firstLine, secondLine] = world.lines;
    await world.run(AUDIO_EDIT_COMMANDS.move, { target: { kind: 'clip', clipId: secondLine }, by: f(15) });
    expect(voiceStarts(world.doc())).toEqual([[10, 20], [55, 20]]);
    await world.run(AUDIO_EDIT_COMMANDS.trim, { target: { kind: 'clip', clipId: firstLine }, edge: 'start', by: f(5) });
    expect(voiceStarts(world.doc())).toEqual([[5, 25], [55, 20]]);
    expect(clipByTrack(world.doc(), firstLine as string)?.sourceStart.value).toBe(5);
    const crash = await world.run(AUDIO_EDIT_COMMANDS.move, { target: { kind: 'clip', clipId: firstLine }, by: f(40) });
    expect(!crash.ok && crash.error.code).toBe('timeline.invalid_move');
    const early = await world.run(AUDIO_EDIT_COMMANDS.trim, { target: { kind: 'clip', clipId: firstLine }, edge: 'start', by: f(10) });
    expect(!early.ok && early.error.code).toBe('timeline.invalid_move');
    await world.undo();
    expect(voiceStarts(world.doc())).toEqual([[10, 20], [55, 20]]);
  });

  it('a V1 clip’s sound moves with its picture', async () => {
    const world = await soundWorld();
    const refused = await world.run(AUDIO_EDIT_COMMANDS.move, { target: { kind: 'clip', clipId: world.built.ids[0] }, by: f(3) });
    expect(!refused.ok && refused.error.code).toBe('timeline.invalid_move');
  });

  it('the music moves its window and shift together, and a trim its window only', async () => {
    const world = await soundWorld();
    await world.run(AUDIO_EDIT_COMMANDS.move, { target: { kind: 'music' }, by: f(30) });
    expect(world.doc().mix.music).toMatchObject({ start: f(30), shift: f(30), end: null });
    await world.run(AUDIO_EDIT_COMMANDS.trim, { target: { kind: 'music' }, edge: 'end', by: f(-30) });
    expect(world.doc().mix.music).toMatchObject({ start: f(30), end: f(60) });
    await world.run(AUDIO_EDIT_COMMANDS.trim, { target: { kind: 'music' }, edge: 'start', by: f(15) });
    expect(world.doc().mix.music).toMatchObject({ start: f(15), shift: f(30) });
    const backwards = await world.run(AUDIO_EDIT_COMMANDS.trim, { target: { kind: 'music' }, edge: 'end', by: f(-60) });
    expect(!backwards.ok && backwards.error.code).toBe('timeline.invalid_move');
  });
});

function clipByTrack(timeline: Timeline, id: string): Clip | undefined {
  for (const track of timeline.tracks) {
    if (track.kind === 'text') continue;
    const found = track.items.find((item) => item.id === id);
    if (found?.type === 'clip') return found;
  }
  return undefined;
}
