// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: a kept reel clip beside a dissolve or a fade never shows the frames the reel blended with the shot the
 * person's clip replaces. The kept clip is cut clear of them, a held clean frame stands in, and the transition is
 * drawn again between the person's clip and that frame, with the reel's kind and length. The owner's reel is the
 * first case: their clip dissolves, over frames 296 to 308, into a film shot that is clean from frame 309.
 */
import { timelineSchema, type Clip, type SequenceItem, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { reelBlends, reelEdges } from '../src/assembly/reel-transitions';
import { cutsOffAnchor } from '../src/model/checks';
import { agentWorldOver } from './fixtures/agent';
import { reelSource, reelWorld, type ReelWorldDef } from './fixtures/reel';
import type { SlotDef } from './fixtures/template';

async function made(def: ReelWorldDef) {
  const cast = reelWorld(def);
  const reel = reelSource();
  const w = agentWorldOver(cast, { keptAudio: true, reel: reel.source });
  const assembled = await w.call('timeline.assemble', {
    projectId: w.projectId,
    template: { id: cast.template.id },
  });
  if (!assembled.ok) throw new Error(assembled.error.code);
  const timeline = w.store.docs.get((assembled.value.timelineIds as string[])[0]!)!;
  return { cast, reel, answer: assembled.value, timeline };
}

const video = (timeline: Timeline): readonly SequenceItem[] =>
  timeline.tracks.flatMap((track) => (track.kind === 'video' ? track.items : []));
const shape = (timeline: Timeline) =>
  video(timeline).map((item) =>
    item.type === 'clip'
      ? item.holdFrame
        ? `hold ${item.holdFrame.value} x${item.duration.value}`
        : `clip ${item.sourceStart.value}+${item.duration.value}`
      : item.type === 'transition'
        ? `${item.kind} ${item.inOffset.value}/${item.outOffset.value}`
        : item.type,
  );
/** The reel's frames a timeline shows, held ones included. */
function reelFrames(timeline: Timeline, reelAsset: string): Set<number> {
  const shown = new Set<number>();
  for (const item of video(timeline)) {
    if (item.type !== 'clip' || item.media.assetId !== reelAsset) continue;
    if (item.holdFrame) shown.add(item.holdFrame.value);
    else for (let k = 0; k < item.duration.value; k++) shown.add(item.sourceStart.value + k);
  }
  return shown;
}

/** The owner's reel as MATCH1's breakdown reads it: the cut inside the dissolve, at frame 303. */
const OWNER: readonly SlotDef[] = [
  { frames: 303, text: 'the creator presses a button on a controller' },
  {
    frames: 21,
    text: 'a film shot: an armoured finger presses a button',
    transition: { kind: 'dissolve', before: 7, after: 6 },
  },
  { frames: 121, text: 'a film shot: a face' },
  { frames: 25, text: 'the film scene ends' },
];

describe('a kept reel clip beside a dissolve (MATCH1)', () => {
  it('the owner’s reel: their clip dissolves into the film shot’s first clean frame, which then plays', async () => {
    const { cast, reel, answer, timeline } = await made({ kept: [1, 2, 3], slots: OWNER });
    expect(shape(timeline)).toEqual([
      expect.stringMatching(/^clip \d+\+303$/),
      'dissolve 7/6',
      'hold 309 x6',
      'clip 309+15',
      'clip 324+121',
      'clip 445+25',
    ]);
    // The video is as long as the reel, and the kept shots sit where they sat in it (under the reel's sound).
    const items = video(timeline).filter((item): item is Clip => item.type === 'clip');
    expect(items.reduce((sum, item) => sum + item.duration.value, 0)).toBe(470);
    // No frame the reel blended (296 to 308) is shown: the kept footage starts at 309.
    const shown = reelFrames(timeline, reel.assetId);
    expect([...shown].filter((frame) => frame < 309)).toEqual([]);
    expect(shown.size).toBe(470 - 309);

    const [person, held, film] = items as [Clip, Clip, Clip];
    expect(person.media.assetId).toBe(cast.profiles[0]!.assetId);
    // The held frame is the reel's, silent and still, and no slot's own; the playing clip is the slot's.
    expect(held).toMatchObject({
      slotId: null,
      speed: null,
      fit: 'contain',
      locked: false,
      audio: { muted: true },
      media: { assetId: reel.assetId },
    });
    expect(held.sourceStart).toEqual(held.holdFrame);
    expect(film.slotId).toBe(cast.template.slots[1]!.id);
    expect(timeline.cast!.slots[1]).toMatchObject({ note: 'reelKept', clipId: film.id });
    expect(timeline.cast!.slots[1]!.pick!.sourceStart.value).toBe(309);
    // A stored timeline: it parses as it is.
    expect(timelineSchema.safeParse(JSON.parse(JSON.stringify(timeline))).success).toBe(true);
    // And the assembly says what it did at that edge.
    expect(answer.reelBlends).toEqual([
      { slotId: cast.template.slots[1]!.id, edge: 'start', kind: 'dissolve', frames: 6, redrawn: true },
    ]);
  });

  it('both ways, on the beat: into the reel’s footage and out of it, and between the person’s own clips', async () => {
    const dissolve = { kind: 'dissolve' as const, before: 4, after: 4 };
    const slots = [
      { frames: 90, text: 'the creator talks to the camera' },
      { frames: 60, text: 'a film scene: an actor answers', transition: dissolve },
      { frames: 60, text: 'the film scene ends' },
      { frames: 60, text: 'the creator again', transition: dissolve },
      { frames: 60, text: 'the creator waves', transition: dissolve },
    ];
    const { cast, reel, answer, timeline } = await made({ kept: [1, 2], slots, clips: 3 });
    expect(shape(timeline)).toEqual([
      expect.stringMatching(/^clip \d+\+90$/),
      'dissolve 4/4',
      'hold 94 x4',
      'clip 94+56',
      // Between two kept slots the cut is the reel's own.
      'clip 150+56',
      'hold 205 x4',
      'dissolve 4/4',
      expect.stringMatching(/^clip \d+\+60$/),
      // Between the person's own clips, the template's dissolve as before.
      'dissolve 4/4',
      expect.stringMatching(/^clip \d+\+60$/),
    ]);
    // The reel blended 86..93 and 206..213: none of those frames is shown.
    const shown = reelFrames(timeline, reel.assetId);
    expect([...shown].filter((frame) => frame < 94 || frame > 205)).toEqual([]);
    // The cut's beat is the held frame's (it starts on the cut); nothing is off its anchor.
    const clips = video(timeline).filter((item): item is Clip => item.type === 'clip');
    expect(clips[1]!.beatAnchor).toEqual(cast.template.slots[1]!.beatAnchor);
    expect(clips[2]!.beatAnchor).toBeNull();
    expect(cutsOffAnchor(timeline)).toEqual([]);
    expect(answer.reelBlends).toEqual([
      { slotId: cast.template.slots[1]!.id, edge: 'start', kind: 'dissolve', frames: 4, redrawn: true },
      { slotId: cast.template.slots[2]!.id, edge: 'end', kind: 'dissolve', frames: 4, redrawn: true },
    ]);
  });

  it('a fade through black is cut clear the same way', async () => {
    const slots = [
      { frames: 90, text: 'the creator talks to the camera' },
      { frames: 60, text: 'a film scene', transition: { kind: 'fade' as const, before: 9, after: 7 } },
    ];
    const { answer, timeline } = await made({ kept: [1], slots });
    expect(shape(timeline).slice(1)).toEqual(['fade 9/7', 'hold 97 x7', 'clip 97+53']);
    expect(answer.reelBlends).toMatchObject([{ edge: 'start', kind: 'fade', frames: 7, redrawn: true }]);
  });

  it('holds one frame at least: a blend wholly on the person’s side still needs a clean frame under it', () => {
    const slots = [
      { frames: 90, text: 'the creator' },
      { frames: 60, text: 'a film scene', transition: { kind: 'dissolve' as const, before: 8, after: 0 } },
      {
        frames: 60,
        text: 'the creator again',
        transition: { kind: 'dissolve' as const, before: 0, after: 8 },
      },
    ];
    const { template } = reelWorld({ kept: [1], slots, clips: 2 });
    expect(reelEdges(template, 1)).toEqual({ lead: 1, tail: 1 });
    expect(reelEdges(template, 0)).toEqual({ lead: 0, tail: 0 });
  });

  it('says so when a kept slot is too short to be cut clear: it plays whole, as the reel had it', async () => {
    const slots = [
      { frames: 90, text: 'the creator talks to the camera' },
      { frames: 6, text: 'a film scene', transition: { kind: 'dissolve' as const, before: 4, after: 6 } },
      { frames: 84, text: 'the film scene goes on' },
    ];
    const { cast, answer, timeline } = await made({ kept: [1, 2], slots });
    expect(shape(timeline).slice(1)).toEqual(['clip 90+6', 'clip 96+84']);
    expect(answer.reelBlends).toEqual([
      { slotId: cast.template.slots[1]!.id, edge: 'start', kind: 'dissolve', frames: 6, redrawn: false },
    ]);
    expect(reelBlends({ ...cast.template, slots: cast.template.slots.slice(0, 1) })).toEqual([]);
  });

  it('a template with no blended edge answers nothing about it', async () => {
    const { answer } = await made({ kept: [1, 2] });
    expect(answer.reelBlends).toBeUndefined();
  });
});
