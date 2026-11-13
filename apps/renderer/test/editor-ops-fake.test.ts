// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the fake runs the editor's new edits as the real timeline does in outline (split, ripple delete, speed,
 * a transition into the next clip, colour, a clip's own sound), and ⌘Z puts each back exactly.
 */
import {
  AUDIO_EDIT_COMMANDS,
  callRpc,
  CAPTION_COMMANDS,
  EDITOR_COMMANDS,
  RationalTime,
  type Clip,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[1]!;

function setup() {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } }, make: { renderTickMs: 0 } });
  const run = (name: string, payload: Record<string, unknown>) =>
    callRpc(client.commands.dispatch({ name, payload: { projectId, timelineId, ...payload }, source: 'ui' }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const timeline = () => client.timelines.get({ timelineId });
  return { run, undo, timeline };
}

const items = (timeline: Timeline) => timeline.tracks[0]!.items;
const clips = (timeline: Timeline) => items(timeline).filter((item): item is Clip => item.type === 'clip');
const total = (timeline: Timeline) =>
  items(timeline).reduce((sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value), 0);

describe('the editor’s edits in the fake (EDT1-OPS)', () => {
  it('splits a clip at a frame, and ⌘Z joins it again', async () => {
    const s = setup();
    const before = await s.timeline();
    const first = clips(before)[0]!;
    const at = RationalTime.of(Math.floor(first.duration.value / 2), before.canvas.rate);
    await s.run(EDITOR_COMMANDS.splitClip, { clipId: first.id, at });
    const after = await s.timeline();
    expect(clips(after)).toHaveLength(clips(before).length + 1);
    expect(clips(after)[0]!.duration.value + clips(after)[1]!.duration.value).toBe(first.duration.value);
    expect(total(after)).toBe(total(before));
    await s.undo();
    expect(items(await s.timeline())).toEqual(items(before));
  });

  it('takes a clip out and closes up, and ⌘Z puts it back', async () => {
    const s = setup();
    const before = await s.timeline();
    const second = clips(before)[1]!;
    await s.run(EDITOR_COMMANDS.deleteClip, { clipId: second.id, mode: 'ripple' });
    const after = await s.timeline();
    expect(clips(after).map((clip) => clip.id)).not.toContain(second.id);
    expect(total(after)).toBe(total(before) - second.duration.value);
    await s.undo();
    expect(items(await s.timeline())).toEqual(items(before));
  });

  it('plays a clip at half speed over twice the length, then adds a crossfade into the next one', async () => {
    const s = setup();
    const before = await s.timeline();
    const first = clips(before)[0]!;
    await s.run(EDITOR_COMMANDS.setSpeed, { clipId: first.id, speed: { kind: 'constant', speed: 0.5 } });
    const slowed = clips(await s.timeline())[0]!;
    expect(slowed.speed?.points.every((point) => point.speed === 0.5)).toBe(true);
    expect(slowed.duration.value).toBe(first.duration.value * 2);
    await s.run(EDITOR_COMMANDS.setTransition, {
      clipId: first.id,
      edge: 'end',
      kind: 'dissolve',
      direction: null,
    });
    const after = await s.timeline();
    const index = items(after).findIndex((item) => item.id === first.id);
    expect(items(after)[index + 1]).toMatchObject({ type: 'transition', kind: 'dissolve' });
    await s.undo();
    await s.undo();
    expect(items(await s.timeline())).toEqual(items(before));
  });

  it('grades a clip and sets its own sound, each undone exactly', async () => {
    const s = setup();
    const before = await s.timeline();
    const first = clips(before)[0]!;
    await s.run(EDITOR_COMMANDS.setGrade, {
      target: { kind: 'clips', clipIds: [first.id] },
      grade: { look: 'mono' },
    });
    expect(clips(await s.timeline())[0]!.grade?.look).toBe('mono');
    await s.run(AUDIO_EDIT_COMMANDS.setVolume, {
      target: { kind: 'clips', clipIds: [first.id] },
      gainDb: -6,
      muted: false,
    });
    expect(clips(await s.timeline())[0]!.audio).toMatchObject({ gainDb: -6, muted: false });
    await s.undo();
    await s.undo();
    expect(clips(await s.timeline())[0]).toEqual(first);
  });

  it('changes a caption’s words, and ⌘Z puts them back', async () => {
    const s = setup();
    const before = await s.timeline();
    const cue = before.captions!.cues[0]!;
    await s.run(CAPTION_COMMANDS.editText, { cueId: cue.id, text: 'Morning market light' });
    const edited = (await s.timeline()).captions!.cues[0]!;
    expect(edited.words.map((word) => word.text)).toEqual(['Morning', 'market', 'light']);
    expect(edited.range).toEqual(cue.range);
    await s.undo();
    expect((await s.timeline()).captions).toEqual(before.captions);
  });
});
