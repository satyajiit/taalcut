// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: speed (by media or by length, the sound's policy) and transitions on core's bus. */
import { AUDIO_EDIT_COMMANDS, EDITOR_COMMANDS, type Timeline, type TransitionItem } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { consumedMedia } from '../../src/model/speed';
import { clipById, starts } from '../fixtures/timeline';
import { editorWorld, f, shape } from './editor-world';

const three = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }], texts: [{ start: 60, frames: 20 }] };
const transitions = (timeline: Timeline): TransitionItem[] => {
  const video = timeline.tracks[0];
  return video?.kind === 'video' ? video.items.filter((item): item is TransitionItem => item.type === 'transition') : [];
};

describe('timeline.setSpeed', () => {
  it('half speed keeps what the clip shows: twice as long, what follows later, undone in one step', async () => {
    const world = await editorWorld(three);
    const [, second] = world.built.ids;
    expect((await world.run(EDITOR_COMMANDS.setSpeed, { clipId: second, speed: { kind: 'constant', speed: 0.5 } })).ok).toBe(true);
    const slow = clipById(world.doc(), second as string);
    expect([slow.duration.value, slow.speed?.points.map((p) => [p.at.value, p.speed])]).toEqual([60, [[0, 0.5], [60, 0.5]]]);
    expect(consumedMedia(slow, slow.sourceStart.rate, world.doc().canvas.rate).value).toBe(30);
    expect(starts(world.doc())).toEqual([0, 30, 90, 120]);
    const track = world.doc().tracks.find((t) => t.kind === 'text');
    expect(track?.kind === 'text' && track.items[0]?.start.value).toBe(90);
    await world.undo();
    expect(clipById(world.doc(), second as string).speed).toBeNull();
    expect(starts(world.doc())).toEqual([0, 30, 60, 90]);
  });

  it('by length keeps the place and shows more media, refused when the media runs out', async () => {
    const world = await editorWorld({ clips: [{ frames: 30 }, { frames: 30, media: 160 }] });
    const [first, second] = world.built.ids;
    expect((await world.run(EDITOR_COMMANDS.setSpeed, { clipId: first, speed: { kind: 'constant', speed: 2 }, fit: 'length' })).ok).toBe(true);
    expect(clipById(world.doc(), first as string).duration.value).toBe(30);
    const tooFast = await world.run(EDITOR_COMMANDS.setSpeed, { clipId: second, speed: { kind: 'constant', speed: 3 }, fit: 'length' });
    expect(!tooFast.ok && tooFast.error.code).toBe('timeline.media_too_short');
  });

  it('a ramp over shares of the clip, and back to normal', async () => {
    const world = await editorWorld(three);
    const [first] = world.built.ids;
    const ramp = { kind: 'ramp', curve: 'linear', points: [{ at: 0, speed: 1 }, { at: 0.5, speed: 3 }, { at: 1, speed: 1 }] };
    expect((await world.run(EDITOR_COMMANDS.setSpeed, { clipId: first, speed: ramp })).ok).toBe(true);
    const ramped = clipById(world.doc(), first as string);
    expect(ramped.speed?.points.map((p) => p.at.value)).toEqual([0, 8, 15]);
    expect(ramped.duration.value).toBe(15);
    expect((await world.run(EDITOR_COMMANDS.setSpeed, { clipId: first, speed: { kind: 'normal' } })).ok).toBe(true);
    expect(clipById(world.doc(), first as string).speed).toBeNull();
    expect(starts(world.doc()).every((frame) => frame % 15 === 0)).toBe(true);
  });

  it('mutes the clip’s sound outside 0.5–2× unless asked, and keeps it within', async () => {
    const world = await editorWorld(three);
    const [first, second] = world.built.ids;
    await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'clips', clipIds: [first, second] }, muted: false });
    await world.run(EDITOR_COMMANDS.setSpeed, { clipId: first, speed: { kind: 'constant', speed: 1.5 } });
    await world.run(EDITOR_COMMANDS.setSpeed, { clipId: second, speed: { kind: 'constant', speed: 4 } });
    expect(clipById(world.doc(), first as string).audio.muted).toBe(false);
    expect(clipById(world.doc(), second as string).audio.muted).toBe(true);
    await world.run(AUDIO_EDIT_COMMANDS.setVolume, { target: { kind: 'clips', clipIds: [second] }, muted: false });
    await world.run(EDITOR_COMMANDS.setSpeed, { clipId: second, speed: { kind: 'constant', speed: 1.2 }, audio: 'mute' });
    expect(clipById(world.doc(), second as string).audio.muted).toBe(true);
  });

  it('refuses a photo', async () => {
    const world = await editorWorld({ clips: [{ frames: 30, image: true }, { frames: 30 }] });
    const still = await world.run(EDITOR_COMMANDS.setSpeed, { clipId: world.built.ids[0], speed: { kind: 'constant', speed: 2 } });
    expect(!still.ok && still.error.code).toBe('timeline.invalid_move');
  });
});

describe('timeline.setTransition and removeTransition', () => {
  it('a crossfade into the next clip, half a second centred on the cut; set again it changes in place', async () => {
    const world = await editorWorld(three);
    const [first] = world.built.ids;
    const set = await world.run(EDITOR_COMMANDS.setTransition, { clipId: first, kind: 'dissolve' });
    const id = set.ok ? (set.value as { itemId: string }).itemId : '';
    expect(shape(world.doc())).toEqual([['clip', 30], 'dissolve', ['clip', 30], ['clip', 30]]);
    expect(transitions(world.doc()).map((t) => [t.inOffset.value, t.outOffset.value])).toEqual([[7, 8]]);
    await world.run(EDITOR_COMMANDS.setTransition, { clipId: first, kind: 'zoom', direction: 'down', duration: f(10) });
    expect(transitions(world.doc())).toMatchObject([{ id, kind: 'zoom', direction: 'down' }]);
    await world.run(EDITOR_COMMANDS.setTransition, { clipId: world.built.ids[1], edge: 'start', kind: 'fade', direction: 'left' });
    expect(transitions(world.doc())).toMatchObject([{ id, kind: 'fade', direction: null }]);
    expect(starts(world.doc())).toEqual([0, 30, 60, 90]);
    await world.undo();
    expect(transitions(world.doc())[0]?.kind).toBe('zoom');
  });

  it('leans to the side with media when one clip has none before its in-point', async () => {
    const world = await editorWorld({ clips: [{ frames: 30 }, { frames: 30, sourceStart: 0, sync: null }] });
    await world.run(EDITOR_COMMANDS.setTransition, { clipId: world.built.ids[0], kind: 'dissolve' });
    expect(transitions(world.doc()).map((t) => [t.inOffset.value, t.outOffset.value])).toEqual([[0, 15]]);
  });

  it('needs a clip on that side', async () => {
    const world = await editorWorld({ clips: [{ frames: 30 }, { frames: 30, gap: true }, { frames: 30 }] });
    const last = await world.run(EDITOR_COMMANDS.setTransition, { clipId: world.built.ids[2], kind: 'flash' });
    expect(!last.ok && last.error.code).toBe('timeline.invalid_move');
    const gap = await world.run(EDITOR_COMMANDS.setTransition, { clipId: world.built.ids[0], kind: 'flash' });
    expect(!gap.ok && gap.error.code).toBe('timeline.invalid_move');
  });

  it('removes by the clip’s edge or by id; none there writes nothing', async () => {
    const world = await editorWorld({ clips: [{ frames: 30 }, { frames: 30, transition: ['dissolve', 5, 5] }, { frames: 30, transition: ['whip', 3, 3] }] });
    const [first, second] = world.built.ids;
    const whip = transitions(world.doc())[1]!;
    await world.run(EDITOR_COMMANDS.removeTransition, { clipId: first });
    await world.run(EDITOR_COMMANDS.removeTransition, { transitionId: whip.id });
    expect(transitions(world.doc())).toEqual([]);
    const revision = world.doc().revision;
    expect((await world.run(EDITOR_COMMANDS.removeTransition, { clipId: second, edge: 'start' })).ok).toBe(true);
    expect(world.doc().revision).toBe(revision);
    const unknown = await world.run(EDITOR_COMMANDS.removeTransition, { transitionId: first });
    expect(!unknown.ok && unknown.error.code).toBe('timeline.item_not_found');
  });
});
