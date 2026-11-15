// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: a template slot states a moment that must land on its start or end; the cast lists it, the AI states when
 * that instant is in the slot's shot (as the slot's part: its `to` or `from`, seconds of the file), and the tools
 * put that frame on the edge and answer what they did. The owner's case: a 22 s clip at 60 frames a second, the
 * instant at 18.4 s, the slot ending in a dissolve into the reel's own film shot. Nothing here looks for a moment:
 * every time is stated.
 */
import { FrameRates, type Clip, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LIBRARIAN_EXTRA_TOOLS, timelineSkillModule } from '../src/skills/skills';
import { landingFrame } from '../src/tools/landed-moments';
import { LANDS_WORDS } from '../src/tools/moment-answers';
import { agentWorldOver, type AgentWorldOptions } from './fixtures/agent';
import { reelSource, reelWorld, type ReelWorld, type ReelWorldDef } from './fixtures/reel';
import type { SlotDef } from './fixtures/template';

const PRESS = { edge: 'end', moment: 'A finger presses the button' } as const;
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
/** The owner's reel and clip: 22 s at 60 frames a second (its file runs to 22.5 s). */
const OWNER_WORLD: ReelWorldDef = {
  kept: [1, 2, 3],
  slots: OWNER,
  lands: { 0: PRESS },
  clip: { frames: 1320, rate: FrameRates.fps60 },
};

type Moment = Record<string, unknown>;
type SlotRow = { slotId: string; shotId: string | null; moment?: Moment };

function setup(def: ReelWorldDef, options: (cast: ReelWorld) => AgentWorldOptions = () => ({})) {
  const cast = reelWorld(def);
  const w = agentWorldOver(cast, { keptAudio: true, reel: reelSource().source, ...options(cast) });
  const target = { projectId: w.projectId, template: { id: cast.template.id } };
  const slot = (index: number) => cast.template.slots[index]!.id as string;
  const shot = (index = 0) => cast.profiles[index]!.shotId as string;
  async function run(name: 'timeline.cast' | 'timeline.assemble', extra: Record<string, unknown> = {}) {
    const result = await w.call(name, { ...target, ...extra });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    return result.value;
  }
  async function assembled(extra: Record<string, unknown>) {
    const answer = await run('timeline.assemble', extra);
    const timeline = w.store.docs.get((answer.timelineIds as string[])[0]!)!;
    return { answer, timeline, moments: answer.moments as Moment[] | undefined };
  }
  return { cast, w, slot, shot, run, assembled };
}

const clipOf = (timeline: Timeline, slotId: string): Clip =>
  timeline.tracks
    .flatMap((track) => (track.kind === 'video' ? track.items : []))
    .find((item): item is Clip => item.type === 'clip' && item.slotId === slotId)!;

describe('where a stated instant sits on a slot (MATCH1)', () => {
  it('is the last frame before the transition out begins, or the first after the transition in ends', () => {
    const { template } = reelWorld({ kept: [], slots: OWNER });
    // Slot 0 ends in a dissolve that starts 7 frames before the cut: frame 295 of its 303.
    expect(landingFrame(template, 0, 'end')).toBe(295);
    expect(landingFrame(template, 0, 'start')).toBe(0);
    // Slot 1 starts 6 frames inside the dissolve, and ends on a hard cut.
    expect(landingFrame(template, 1, 'start')).toBe(6);
    expect(landingFrame(template, 1, 'end')).toBe(20);
    expect(landingFrame(template, 3, 'end')).toBe(24);
  });
});

describe('a moment that lands on a slot’s edge (MATCH1)', () => {
  it('the cast lists the slots that state one, with how to state it and the instant a part was read as', async () => {
    const { run, slot, shot, w } = setup(OWNER_WORLD);
    const read = await run('timeline.cast');
    expect(read.lands).toEqual({
      how: LANDS_WORDS,
      slots: [{ slotId: slot(0), edge: 'end', moment: 'A finger presses the button' }],
    });
    const rows = (read.variants as { slots: SlotRow[] }[])[0]!.slots;
    expect(rows[0]).toMatchObject({ slotId: slot(0), shotId: shot() });
    expect(rows.every((row) => row.moment === undefined)).toBe(true);

    // The instant is the part's `to`, since the template says the moment lands on the slot's end.
    const stated = await run('timeline.cast', {
      parts: [{ slotId: slot(0), shotId: shot(), from: 17.9, to: 18.4 }],
    });
    expect(stated.lands).toEqual({
      how: LANDS_WORDS,
      slots: [{ slotId: slot(0), edge: 'end', moment: 'A finger presses the button', at: 18.4 }],
    });
    expect((stated.variants as { slots: SlotRow[] }[])[0]!.slots[0]).toMatchObject({
      playsShotFrom: 8.57,
      moment: {
        shotId: shot(),
        edge: 'end',
        at: 18.4,
        landed: true,
        videoSeconds: 9.83,
        playsShotFrom: 8.57,
        playsShotTo: 18.67,
      },
    });
    // No input was added for it: the tools take what they took (the Librarian's window has no room for more).
    const offered = (name: string) => {
      const tool = w.tools.tools.find((candidate) => candidate.name === name)!;
      return Object.keys((z.toJSONSchema(tool.input, { io: 'input' }) as { properties: object }).properties);
    };
    expect(offered('timeline.cast')).not.toContain('moments');
    expect(offered('timeline.assemble')).not.toContain('moments');
    // A template with no such slot pays no words for it, and its parts are MOM1's alone.
    const plain = setup({ kept: [1, 2, 3], slots: OWNER, clip: OWNER_WORLD.clip! });
    expect((await plain.run('timeline.cast')).lands).toBeUndefined();
    const part = { slotId: plain.slot(0), shotId: plain.shot(), from: 17.9, to: 18.4 };
    const made = await plain.run('timeline.assemble', { parts: [part] });
    expect(made.lands).toBeUndefined();
    expect(made.moments).toBeUndefined();
  });

  it('the owner’s make: 18.4 s of their clip is the last frame before the dissolve, and the answer says so', async () => {
    const { assembled, slot, shot, cast } = setup(OWNER_WORLD);
    const { answer, timeline, moments } = await assembled({
      parts: [{ slotId: slot(0), shotId: shot(), from: 17.9, to: 18.4 }],
    });
    expect(moments).toEqual([
      {
        timelineId: timeline.id,
        slotId: slot(0),
        shotId: shot(),
        edge: 'end',
        at: 18.4,
        landed: true,
        videoSeconds: 9.83,
        playsShotFrom: 8.57,
        playsShotTo: 18.67,
      },
    ]);
    expect(answer.lands).toMatchObject({ slots: [{ slotId: slot(0), edge: 'end', at: 18.4 }] });
    const clip = clipOf(timeline, slot(0));
    // Frame 1104 of the file (18.4 s at 60) shows at the video's frame 295: 590 file frames after the in-point.
    expect([clip.sourceStart.value, clip.sourceStart.rate]).toEqual([514, FrameRates.fps60]);
    expect(clip.duration.value).toBe(303);
    // The statement's in-point, not a person's lock: the clip stays theirs to edit.
    expect(clip.locked).toBe(false);
    expect(clip.syncPoint).toBeNull();
    expect(timeline.cast!.slots[0]).toMatchObject({ note: null, clipId: clip.id });
    expect(timeline.cast!.slots[0]!.pick!.sourceStart.value).toBe(514);
    expect(cast.profiles[0]!.assetId).toBe(clip.media.assetId);
  });

  it('without the instant the assembly lists the slot with no instant taken', async () => {
    const { assembled, slot, shot } = setup(OWNER_WORLD);
    const asked = { slotId: slot(0), edge: 'end', moment: 'A finger presses the button' };
    const none = await assembled({});
    expect(none.moments).toBeUndefined();
    expect(none.answer.lands).toEqual({ how: LANDS_WORDS, slots: [asked] });
    // A part with no `to` gives no instant for a slot's end: it is MOM1's part, and no instant is taken.
    const open = await assembled({ parts: [{ slotId: slot(0), shotId: shot(), from: 12 }] });
    expect(open.moments).toBeUndefined();
    expect(open.answer.lands).toEqual({ how: LANDS_WORDS, slots: [asked] });
    // A part stated for another reason is read the same way, and the answer says which instant was taken.
    const wide = await assembled({ parts: [{ slotId: slot(0), shotId: shot(), from: 17.9, to: 19.5 }] });
    expect(wide.answer.lands).toEqual({ how: LANDS_WORDS, slots: [{ ...asked, at: 19.5 }] });
    expect(wide.moments![0]).toMatchObject({ at: 19.5, landed: true, playsShotTo: 19.77 });
  });

  it('a stated moment replaces a locked in-point, and the person’s lock stays', async () => {
    const { assembled, slot, shot, cast } = setup(OWNER_WORLD);
    const profile = cast.profiles[0]!;
    const { timeline, moments } = await assembled({
      locked: [
        {
          slotId: slot(0),
          assetId: profile.assetId,
          shotId: profile.shotId,
          sourceStart: { value: 510, rate: FrameRates.fps60 },
        },
      ],
      parts: [{ slotId: slot(0), shotId: shot(), from: 17.9, to: 18.4 }],
    });
    expect(moments![0]).toMatchObject({ landed: true, playsShotFrom: 8.57 });
    const clip = clipOf(timeline, slot(0));
    expect(clip.sourceStart.value).toBe(514);
    expect(clip.locked).toBe(true);
    expect(timeline.cast!.slots[0]!.note).toBe('userPick');
  });

  it('says why, with the numbers, when the slot’s window can’t lie there, and leaves the clip MOM1’s', async () => {
    const { assembled, slot, shot } = setup(OWNER_WORLD);
    const early = await assembled({ parts: [{ slotId: slot(0), shotId: shot(), from: 2, to: 3 }] });
    expect(early.moments![0]).toMatchObject({
      landed: false,
      why: 'The slot plays 9.83 s of the shot before this instant, and the file has 3 s before 3 s.',
    });
    expect(early.moments![0]!.videoSeconds).toBeUndefined();
    // The clip is where MOM1 puts a part too short for the slot (made long enough), and the answer says where.
    const asCast = clipOf(early.timeline, slot(0)).sourceStart.value;
    expect(asCast).not.toBe(514);
    expect(early.moments![0]!.playsShotFrom).toBe(Math.round((asCast / 60) * 100) / 100);
    const outside = await assembled({ parts: [{ slotId: slot(0), shotId: shot(), from: 20, to: 30 }] });
    expect(outside.moments![0]!.why).toBe('The shot’s file runs 0 to 22.5 s: 30 s is not in it.');

    const starting = setup({ ...OWNER_WORLD, lands: { 0: { edge: 'start', moment: 'The door opens' } } });
    const late = await starting.assembled({
      parts: [{ slotId: starting.slot(0), shotId: starting.shot(), from: 22.4 }],
    });
    expect(late.moments![0]!.why).toBe(
      'The slot plays 10.1 s of the shot from this instant on, and the file has 0.1 s from 22.4 s.',
    );
  });

  it('answers a moment of a shot that does not fill the slot', async () => {
    const { assembled, slot, shot } = setup({ ...OWNER_WORLD, clips: 2 });
    const first = await assembled({});
    const picked = clipOf(first.timeline, slot(0)).media;
    const other = picked.kind === 'video' && picked.shotId === shot(0) ? shot(1) : shot(0);
    const elsewhere = await assembled({ parts: [{ slotId: slot(0), shotId: other, from: 17.9, to: 18.4 }] });
    expect(elsewhere.moments![0]).toMatchObject({
      landed: false,
      why: 'Another shot fills this slot. To put a moment of this shot there, lock it to the slot (locked) as well.',
    });
    expect(elsewhere.moments![0]!.playsShotFrom).toBeUndefined();
  });

  it('on a start edge: the first frame after the transition in, or the slot’s first frame at a hard cut', async () => {
    const slots = [
      { frames: 90, text: 'the creator walks in' },
      {
        frames: 60,
        text: 'the creator sits',
        transition: { kind: 'dissolve' as const, before: 4, after: 4 },
      },
      { frames: 60, text: 'the creator waves' },
    ];
    const sits = { edge: 'start', moment: 'They touch the chair' } as const;
    const { assembled, slot, cast } = setup({ kept: [], slots, clips: 3, lands: { 1: sits, 2: sits } });
    const plain = await assembled({});
    const shotIn = (index: number) => {
      const media = clipOf(plain.timeline, slot(index)).media;
      return media.kind === 'video' ? media.shotId : null;
    };
    const { timeline, moments } = await assembled({
      parts: [
        { slotId: slot(1), shotId: shotIn(1), from: 10 },
        { slotId: slot(2), shotId: shotIn(2), from: 12.5 },
      ],
    });
    // 10 s shows 4 frames into the slot (frame 94 of the video: 3.13 s); 12.5 s is the third slot's first frame.
    expect(moments!.map((moment) => [moment.landed, moment.videoSeconds, moment.playsShotFrom])).toEqual([
      [true, 3.13, 9.87],
      [true, 5, 12.5],
    ]);
    expect(clipOf(timeline, slot(1)).sourceStart.value).toBe(296);
    expect(clipOf(timeline, slot(2)).sourceStart.value).toBe(375);
    expect(cast.profiles).toHaveLength(3);
  });

  it('follows the slot’s speed ramp: at twice the speed the slot plays twice the footage before its end', async () => {
    const slots = [
      {
        frames: 60,
        text: 'the creator runs',
        ramp: [
          [0, 2],
          [60, 2],
        ] as const,
      },
      { frames: 60, text: 'the creator stops' },
    ];
    const { assembled, slot, cast } = setup({ kept: [], slots, clips: 2, lands: { 0: PRESS } });
    const plain = await assembled({});
    const media = clipOf(plain.timeline, slot(0)).media;
    const { timeline, moments } = await assembled({
      parts: [{ slotId: slot(0), shotId: media.kind === 'video' ? media.shotId : null, from: 9, to: 10 }],
    });
    // The slot's last frame (59) is 118 file frames in: 300 - 118.
    expect(clipOf(timeline, slot(0)).sourceStart.value).toBe(182);
    expect(moments![0]).toMatchObject({
      landed: true,
      videoSeconds: 1.97,
      playsShotFrom: 6.07,
      playsShotTo: 10.07,
    });
    expect(cast.template.slots[0]!.speedRamp).not.toBeNull();
  });
});

describe('the tools’ versions and the Librarian’s eyes (MATCH1)', () => {
  it('timeline.cast 1.6.0, timeline.assemble 1.5.0, and library.frameStrip offered to the Librarian', () => {
    const { w } = setup(OWNER_WORLD);
    const version = (name: string) => w.tools.tools.find((tool) => tool.name === name)!.version;
    expect(version('timeline.cast')).toBe('1.6.0');
    expect(version('timeline.assemble')).toBe('1.5.0');
    expect(LIBRARIAN_EXTRA_TOOLS).toContain('library.frameStrip');
    const librarian = timelineSkillModule({
      service: w.service,
      templates: w.templates,
      maker: { registered: () => true },
    }).skills.find((skill) => skill.id === 'timeline.librarian')!;
    expect(librarian.version).toBe('1.8.0');
    expect(librarian.tools.names).toContain('library.frameStrip');
    expect(librarian.limits).toEqual({ expectedTurns: 6, maxTurns: 15 });
  });
});
