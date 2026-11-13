// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { MAX_SELECTIONS, type SelectionChip, type TimelineId, type TimelineItemId } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { seedProjects } from '../src/backend/fake/make/seed';
import {
  addCurrentSelection,
  addSelection,
  askWith,
  claimComposerRequest,
  composerRequest,
  currentSelection,
  resetSelectionsForTests,
  selectionKey,
  setCurrentSelection,
  takeSelections,
} from '../src/chat/selection-store';
import { asksForTrim } from '../src/chat/fake-edit-script';
import {
  barBeat,
  beatsBetween,
  buildModel,
  clipAt,
  snapToBeat,
  stepBeat,
  toFrames,
} from '../src/features/timeline/model';
import { createPlayhead } from '../src/features/timeline/playhead';
import { toChip } from '../src/features/timeline/selection';

const golden = seedProjects()
  .projects.flatMap((project) => project.timelines)
  .find((timeline) => timeline.id === GOLDEN_TIMELINES[0])!;

describe('the editor’s model of a timeline (P2-M7)', () => {
  const model = buildModel(golden);

  it('lays the clips edge to edge from the start, numbered, with who chose each', () => {
    expect(model.clips).toHaveLength(12);
    expect(model.clips[0]!.start).toBe(0);
    for (const [index, clip] of model.clips.entries()) {
      expect(clip.number).toBe(index + 1);
      if (index > 0) expect(clip.start).toBe(model.clips[index - 1]!.end);
    }
    expect(model.total).toBe(model.clips.at(-1)!.end);
    // Every clip fills a cast slot: the AI's pick, or yours once you swap it ('userPick').
    expect(model.clips.every((clip) => clip.chosenBy === 'ai')).toBe(true);
    const slot = golden.cast!.slots[3]!;
    const swapped = buildModel({
      ...golden,
      cast: {
        ...golden.cast!,
        slots: golden.cast!.slots.map((s) => (s === slot ? { ...s, note: 'userPick' as const } : s)),
      },
    });
    expect(swapped.clips.filter((clip) => clip.chosenBy === 'you').map((clip) => clip.number)).toEqual([4]);
  });

  it('puts the beat grid in canvas frames: 120 BPM at 30 fps is a beat every 15 frames', () => {
    expect(model.bpm).toBe(120);
    expect(model.beatFrames).toBe(15);
    expect(model.beats.slice(0, 3)).toEqual([0, 15, 30]);
    expect(barBeat(model, 0)).toEqual({ bar: 1, beat: 1 });
    expect(barBeat(model, 16)).toEqual({ bar: 1, beat: 2 });
    expect(barBeat(model, 60)).toEqual({ bar: 2, beat: 1 });
  });

  it('snaps to the nearest beat within reach, steps between beats, and counts them', () => {
    expect(snapToBeat(model, 17)).toBe(15);
    expect(snapToBeat(model, 23)).toBe(30);
    // Ties go earlier, like the timeline's own re-sync.
    expect(snapToBeat(model, 22.5)).toBe(15);
    expect(snapToBeat(model, 21, 3)).toBe(21);
    expect(stepBeat(model, 16, 1)).toBe(30);
    expect(stepBeat(model, 16, -1)).toBe(15);
    expect(stepBeat(model, 0, -1)).toBe(0);
    expect(beatsBetween(model, 30, 120)).toBe(6);
  });

  it('finds the clip on screen at a frame, the last one at the very end', () => {
    const third = model.clips[2]!;
    expect(clipAt(model, third.start)?.item.id).toBe(third.item.id);
    expect(clipAt(model, model.total + 10)?.item.id).toBe(model.clips.at(-1)!.item.id);
  });

  it('rescales times at another rate to whole frames', () => {
    expect(toFrames({ value: 1, rate: { num: 1, den: 1 } }, { num: 30, den: 1 })).toBe(30);
    expect(toFrames({ value: 48, rate: { num: 24, den: 1 } }, { num: 30, den: 1 })).toBe(60);
  });

  it('turns a selection into the chip the chat carries', () => {
    const id = golden.id as TimelineId;
    const clipId = model.clips[1]!.item.id;
    expect(toChip({ kind: 'clip', clipId }, id, model.rate)).toEqual({
      kind: 'clip',
      timelineId: id,
      clipId,
    });
    const range = toChip({ kind: 'range', start: 30, end: 90 }, id, model.rate);
    expect(range).toMatchObject({ kind: 'range', timelineId: id });
    expect(range?.kind === 'range' && range.range.duration.value).toBe(60);
    // EDT1: words on screen, and any other item on the bed, are item chips.
    expect(toChip({ kind: 'text', itemId: clipId }, id, model.rate)).toEqual({
      kind: 'item',
      timelineId: id,
      itemId: clipId,
      itemKind: 'text',
    });
    expect(toChip(null, id, model.rate)).toBeNull();
  });
});

describe('the playhead', () => {
  it('clamps to the film and tells its listeners who moved it', () => {
    const playhead = createPlayhead(() => 0);
    playhead.setFilm(100, 30);
    const seen: [number, string][] = [];
    const stop = playhead.subscribe((frame, source) => seen.push([frame, source]));
    playhead.seek(40);
    playhead.seek(500);
    playhead.seek(-3, 'player');
    stop();
    playhead.seek(10);
    expect(seen).toEqual([
      [40, 'user'],
      [99, 'user'],
      [0, 'player'],
    ]);
  });

  it('asks the bound viewer to play and pause, and follows what the viewer reports', () => {
    const playhead = createPlayhead(() => 0);
    const asked: string[] = [];
    playhead.bindTransport({ play: () => asked.push('play'), pause: () => asked.push('pause') });
    playhead.toggle();
    playhead.setPlaying(true);
    playhead.toggle();
    playhead.setPlaying(false);
    expect(asked).toEqual(['play', 'pause']);
    expect(playhead.playing()).toBe(false);
  });
});

describe('selection chips (V3)', () => {
  afterEach(() => resetSelectionsForTests());
  const timelineId = GOLDEN_TIMELINES[0]!;
  const clip = (n: number): SelectionChip => ({
    kind: 'clip',
    timelineId,
    clipId: `01K7C5M6Q8P0000000000000${String(n).padStart(2, '0')}` as TimelineItemId,
  });

  it('keeps one chip per thing, at most MAX_SELECTIONS, and gives them up with the message', () => {
    expect(addSelection(clip(1))).toBe('added');
    expect(addSelection(clip(1))).toBe('already');
    for (let n = 2; n <= MAX_SELECTIONS; n += 1) addSelection(clip(n));
    expect(addSelection(clip(99))).toBe('full');
    const taken = takeSelections();
    expect(taken).toHaveLength(MAX_SELECTIONS);
    expect(new Set(taken.map(selectionKey)).size).toBe(MAX_SELECTIONS);
    expect(takeSelections()).toEqual([]);
  });

  it('adds what the editor has selected, and nothing when nothing is', () => {
    expect(addCurrentSelection()).toBeNull();
    setCurrentSelection(clip(3));
    expect(currentSelection()).toEqual(clip(3));
    expect(addCurrentSelection()).toBe('added');
    expect(takeSelections()).toEqual([clip(3)]);
  });

  it('hands an "Ask about this" request to one composer, once', () => {
    askWith('Why this shot?', [clip(4)]);
    const first = composerRequest();
    expect(first?.text).toBe('Why this shot?');
    expect(claimComposerRequest(first)).toBe(true);
    // The other composer on screen, or this one after a remount: already taken.
    expect(claimComposerRequest(first)).toBe(false);
    askWith('And this one?', []);
    expect(claimComposerRequest(composerRequest())).toBe(true);
    expect(takeSelections()).toEqual([clip(4)]);
  });
});

describe('the fake agent’s trim script', () => {
  it('answers asks for a shorter or longer clip, and nothing else', () => {
    expect(asksForTrim('Make this shot shorter')).toBe(true);
    expect(asksForTrim('a beat longer please')).toBe(true);
    expect(asksForTrim('Make a video from my Goa trip')).toBe(false);
    expect(asksForTrim('the short one')).toBe(false);
  });
});
