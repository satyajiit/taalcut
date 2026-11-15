// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: a slot lengthened by whole bars of the reel's music. The owner's case: a reel of 470 frames whose two bars
 * are 129 frames; the creator's slot (0–302) ends in a dissolve into the reel's own film shots; the creator's clip is
 * 22 s and the instant that must land on the dissolve is at 18.4 s (MATCH1). The slot is made two bars longer: the
 * video is 599 frames, the dissolve and the film shots start 129 frames later on the music they had, and the instant
 * still lands. The tools state nothing themselves: every clip, bar count, bar line and side of footage is the call's.
 */
import { FrameRates, type Clip, type MusicRepeat, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { positions, videoItems } from '../src/model/sequence';
import { placedMoments } from '../src/tools/landed-moments';
import type { musicBarsOutputSchema } from '../src/tools/lengthen-schemas';
import { BARS_WORDS } from '../src/tools/lengthen-tools';
import { agentWorldOver } from './fixtures/agent';
import { reelSource, reelWorld, type ReelWorldDef } from './fixtures/reel';
import { reelMusicOf, steadyBars, UNSTEADY } from './fixtures/reel-music';

const OWNER_WORLD: ReelWorldDef = {
  kept: [1, 2, 3],
  slots: [
    { frames: 303, text: 'the creator presses a button on a controller' },
    {
      frames: 21,
      text: 'a film shot: an armoured finger presses a button',
      transition: { kind: 'dissolve', before: 7, after: 6 },
    },
    { frames: 121, text: 'a film shot: a face' },
    { frames: 25, text: 'the film scene ends' },
  ],
  lands: { 0: { edge: 'end', moment: 'A finger presses the button' } },
  clip: { frames: 1320, rate: FrameRates.fps60 },
};
const TWO_BARS = { clip: 1, bars: 2, at: 10.1, footage: 'before' } as const;

async function setup(music = reelMusicOf(), def: ReelWorldDef = OWNER_WORLD) {
  const cast = reelWorld(def);
  const w = agentWorldOver(cast, { keptAudio: true, reel: reelSource().source, reelMusic: music.source });
  const slot0 = cast.template.slots[0]!.id as string;
  const shot = cast.profiles[0]!.shotId as string;
  const part = { slotId: slot0, shotId: shot, from: 17.9, to: 18.4 };
  const made = await w.call('timeline.assemble', {
    projectId: w.projectId,
    template: { id: cast.template.id },
    parts: [part],
  });
  if (!made.ok) throw new Error(made.error.detail ?? made.error.code);
  const timelineId = (made.value.timelineIds as string[])[0]!;
  const target = { projectId: w.projectId, timelineId };
  const doc = () => w.store.docs.get(timelineId)!;
  const read = async (would?: Record<string, unknown>) => {
    const answer = await w.call('timeline.musicBars', { ...target, ...(would ? { would } : {}) });
    if (!answer.ok) throw new Error(answer.error.detail ?? answer.error.code);
    return answer.value as unknown as z.output<typeof musicBarsOutputSchema>;
  };
  const lengthen = (statement: Record<string, unknown>) =>
    w.call('timeline.lengthenSlot', { ...target, ...statement });
  const moment = { slotId: slot0, shotId: shot, at: 18.4, edge: 'end' as const };
  return { w, cast, target, doc, read, lengthen, moment, music };
}

/** Each V1 clip as [type, first frame, frames] (a transition takes no frames of its own). */
const laid = (timeline: Timeline) =>
  positions(videoItems(timeline)).map(({ item, start, end }) => [item.type, start, end - start]);
const v1 = (timeline: Timeline) => videoItems(timeline).filter((item): item is Clip => item.type === 'clip');
const inPoints = (timeline: Timeline) =>
  v1(timeline).map((clip) => [clip.sourceStart.value, clip.sourceStart.rate.num]);

describe('timeline.musicBars: the facts a video is lengthened by (LONG1)', () => {
  it('answers the bars in seconds of the video with how sure they are, and each clip’s spare footage', async () => {
    const { read, doc } = await setup();
    const answer = await read();
    expect(answer.video).toEqual({ frames: 470, seconds: 15.67, framesPerSecond: 30 });
    expect(answer.music).toMatchObject({
      path: 'referenceAudio',
      measured: true,
      reelSeconds: 15.67,
      bpm: 111.63,
      beatsPerBar: 4,
      barSeconds: 2.15,
      barFrames: 64.5,
      sure: { pulse: 0.82, onBeat: 0.97, bar: 0.74, meter: 0.31, firstBeat: 0.88 },
      measuredAcrossBeats: 16,
      changes: [{ at: 10.1, levelDb: 4.1, bandsDb: 9.4 }],
      repeats: [],
    });
    expect(answer.music.bars.map((bar: { at: number }) => bar.at)).toEqual([
      1.5, 3.65, 5.8, 7.95, 10.1, 12.25, 14.4,
    ]);
    expect(answer.music.bars[4]).toEqual({ at: 10.1, levelDb: -14.2, fromBarBefore: 9.4 });
    // The creator's clip: 10.1 s of a 22.5 s file, with 8.57 s before what it plays and 3.83 s after; the instant
    // on its cut is 18.4 s of the shot, at 9.83 s of the video. The reel's own clips say only that they are.
    expect(answer.clips[0]).toEqual({
      clip: 1,
      clipId: v1(doc())[0]!.id,
      slot: 1,
      from: 0,
      to: 10.1,
      frames: 303,
      shot: { from: 0, to: 22.5, playsFrom: 8.57, playsTo: 18.67, before: 8.57, after: 3.83 },
      lands: { edge: 'end', shotSeconds: 18.4, videoSeconds: 9.83 },
    });
    expect(
      answer.clips.slice(1).map((clip) => [clip.clip, clip.slot, clip.frames, clip.reel, clip.shot]),
    ).toEqual([
      [2, null, 6, true, undefined],
      [3, 2, 15, true, undefined],
      [4, 3, 121, true, undefined],
      [5, 4, 25, true, undefined],
    ]);
    expect(answer.reading).toBe(BARS_WORDS);
    expect(answer.would).toBeUndefined();
    expect(answer.cannot).toBeUndefined();
  });

  it('answers what a stated lengthening would do, and changes nothing', async () => {
    const { read, doc, music } = await setup();
    const before = doc();
    const { would, cannot, revision } = await read(TWO_BARS);
    expect(cannot).toBeUndefined();
    expect(would).toEqual({
      // Two bars of 2.15 s are 4.3 s: 129 frames exactly, the one number for picture and sound.
      frames: 129,
      seconds: 4.3,
      barsSeconds: 4.3,
      offMs: 0,
      video: { fromFrames: 470, toFrames: 599, toSeconds: 19.97 },
      // The crossfade ends 5 ms before the bar line at 10.1 s; the music plays again from 5.795 s of the reel.
      music: {
        at: 10.095,
        backTo: 5.795,
        crossfadeMs: 50,
        seam: { apartDb: 1.4, levelDb: -0.3, overSeconds: 0.25 },
      },
      clip: {
        clip: 1,
        clipId: v1(before)[0]!.id,
        slot: 1,
        from: 0,
        to: 14.4,
        frames: 432,
        longerBy: 129,
        shot: { from: 0, to: 22.5, playsFrom: 4.27, playsTo: 18.67, before: 4.27, after: 3.83 },
        // The same instant of the shot, 129 frames (4.3 s) later in the video.
        lands: { edge: 'end', shotSeconds: 18.4, videoSeconds: 14.13 },
      },
      later: {
        fromSeconds: 10.1,
        clips: 4,
        reelClips: 4,
        transitions: 1,
        texts: 0,
        textsLonger: 0,
        captions: 0,
        sounds: 0,
        markers: 0,
      },
    });
    expect(music.seams).toEqual([[10.095, 4.3]]);
    expect(revision).toBe(1);
    expect(doc()).toEqual(before);
  });
});

describe('timeline.lengthenSlot: the owner’s make, two bars longer (LONG1)', () => {
  it('599 frames: the dissolve and the film shots 129 frames later on their music, the instant still landing', async () => {
    const { lengthen, doc, cast, moment, read } = await setup();
    const before = doc();
    expect(laid(before)).toEqual([
      ['clip', 0, 303],
      ['clip', 303, 6],
      ['clip', 309, 15],
      ['clip', 324, 121],
      ['clip', 445, 25],
    ]);
    const would = (await read(TWO_BARS)).would;
    const done = await lengthen(TWO_BARS);
    if (!done.ok) throw new Error(done.error.detail);
    const after = doc();
    // The answer is what `would` said, with the write's receipt.
    expect(done.value).toEqual({
      timelineId: after.id,
      revision: 2,
      affectedItemIds: expect.any(Array),
      ...would,
    });
    expect(laid(after)).toEqual([
      ['clip', 0, 432],
      ['clip', 432, 6],
      ['clip', 438, 15],
      ['clip', 453, 121],
      ['clip', 574, 25],
    ]);
    expect(positions(videoItems(after)).at(-1)!.end).toBe(599);
    // The creator's clip shows 129 more frames of its shot before what it played: 258 file frames at 60 a second.
    expect(inPoints(before)[0]).toEqual([514, 60]);
    expect(inPoints(after)[0]).toEqual([256, 60]);
    expect(after.cast!.slots[0]!.pick!.sourceStart.value).toBe(256);
    // The reel's own clips, the held frame of the dissolve included, show the reel's frames they showed: each is
    // 129 frames later, and the music under it is the reel's 129 frames (4.3 s) earlier than the video's time.
    expect(inPoints(after).slice(1)).toEqual(inPoints(before).slice(1));
    expect(inPoints(after).slice(1)).toEqual([
      [309, 30],
      [309, 30],
      [324, 30],
      [445, 30],
    ]);
    const transition = videoItems(after)[1]!;
    expect(transition).toEqual(videoItems(before)[1]);
    expect(transition).toMatchObject({ kind: 'dissolve', inOffset: { value: 7 }, outOffset: { value: 6 } });
    // The music: one repeat, at a sample time 5 ms before the bar line, 129 frames back, a 50 ms crossfade.
    const repeat: MusicRepeat = {
      at: { value: 484_560, rate: { num: 48_000, den: 1 } },
      length: { value: 129, rate: FrameRates.fps30 },
      crossfade: { value: 2400, rate: { num: 48_000, den: 1 } },
      bars: 2,
      slotId: cast.template.slots[0]!.id,
    };
    expect(after.mix.musicRepeats).toEqual([repeat]);
    expect(after.music).toEqual(before.music);
    // MATCH1: 18.4 s of the clip is still the last frame before the dissolve begins, now at frame 424.
    expect(placedMoments([after], cast.template, [moment])).toEqual([
      {
        timelineId: after.id,
        slotId: moment.slotId,
        shotId: moment.shotId,
        edge: 'end',
        at: 18.4,
        landed: true,
        videoSeconds: 14.13,
        playsShotFrom: 4.27,
        playsShotTo: 18.67,
      },
    ]);
    expect(placedMoments([before], cast.template, [moment])[0]).toMatchObject({
      landed: true,
      videoSeconds: 9.83,
    });
  });

  it('reads the lengthened video: the bars played again, the repeat, and the clip longer by its frames', async () => {
    const { lengthen, read } = await setup();
    expect((await lengthen(TWO_BARS)).ok).toBe(true);
    const answer = await read();
    expect(answer.video).toEqual({ frames: 599, seconds: 19.97, framesPerSecond: 30 });
    // 5.8 and 7.95 s of the reel sound again at 10.1 and 12.25 s; the drop (10.1 s of the reel) is at 14.4 s.
    expect(answer.music.bars.map((bar) => [bar.at, bar.again ?? false, bar.levelDb])).toEqual([
      [1.5, false, -18.3],
      [3.65, false, -18.3],
      [5.8, false, -18.3],
      [7.95, false, -18.3],
      [10.1, true, -18.3],
      [12.25, true, -18.3],
      [14.4, false, -14.2],
      [16.55, false, -14.2],
      [18.7, false, -14.2],
    ]);
    expect(answer.music.changes).toEqual([{ at: 14.4, levelDb: 4.1, bandsDb: 9.4 }]);
    expect(answer.music.repeats).toEqual([{ at: 10.095, backTo: 5.795, frames: 129, bars: 2, slot: 1 }]);
    expect(answer.clips[0]).toMatchObject({ frames: 432, to: 14.4, longerBy: 129 });
    expect(answer.clips[2]).toMatchObject({ clip: 3, from: 14.6, reel: true });
  });

  it('is one undo step', async () => {
    const { lengthen, doc, w, target } = await setup();
    const before = doc();
    expect((await lengthen(TWO_BARS)).ok).toBe(true);
    expect(doc().revision).toBe(2);
    const undone = await w.bus.undo(target.projectId, { source: 'ui', actor: 'user' });
    expect(undone.ok).toBe(true);
    const back = doc();
    expect(laid(back)).toEqual(laid(before));
    expect(back.mix).toEqual(before.mix);
    expect(back.beatMap).toEqual(before.beatMap);
    expect(back.cast).toEqual(before.cast);
    expect(inPoints(back)).toEqual(inPoints(before));
  });
});

describe('what can’t be done as stated changes nothing and says why, with the numbers (LONG1)', () => {
  const refusal = async (statement: Record<string, unknown>, music = reelMusicOf()) => {
    const { lengthen, read, doc } = await setup(music);
    const before = doc();
    const done = await lengthen(statement);
    expect(done.ok).toBe(false);
    // The read tool's `cannot` is the write's refusal, word for word.
    expect((await read(statement)).cannot).toBe(done.ok ? '' : done.error.detail);
    expect(doc()).toEqual(before);
    return done.ok ? '' : done.error.detail;
  };

  it('a point that is not a bar line', async () => {
    expect(await refusal({ ...TWO_BARS, at: 9 })).toBe(
      '9 s is not a bar line of the music: the nearest are 7.95 s and 10.1 s (a bar is 2.15 s). Nothing was lengthened.',
    );
  });

  it('not enough music before the point to play again', async () => {
    expect(await refusal({ ...TWO_BARS, bars: 4, at: 7.95 })).toBe(
      'The music has 7.95 s before this point and goes back 8.65 s (258 frames and the crossfade): not enough music ' +
        'before it to play again. Nothing was lengthened.',
    );
  });

  it('no steady bars found', async () => {
    expect(await refusal(TWO_BARS, reelMusicOf(UNSTEADY))).toBe(
      'No steady bars were found in the reel’s music. The sound is 0.06 like itself one beat later (0.15 is ' +
        'needed). Nothing was lengthened.',
    );
  });

  it('a shot without that much footage on the side stated', async () => {
    expect(await refusal({ ...TWO_BARS, footage: 'after' })).toBe(
      '129 frames (4.3 s) of the shot after what the clip plays are needed, and its file has 3.83 s there (8.57 s ' +
        'before, 3.83 s after). Nothing was lengthened.',
    );
  });

  it('a bar line outside the clip, and the reel’s own footage', async () => {
    expect(await refusal({ ...TWO_BARS, bars: 1, at: 14.4 })).toBe(
      'The music can go back between 0.05 s and 12.27 s of the video (inside this clip once it is 65 frames ' +
        'longer): 14.4 s is outside it, and a clip before or after it would leave its music. Nothing was lengthened.',
    );
    expect(await refusal({ ...TWO_BARS, clip: 4 })).toBe(
      'This clip is the reel’s own footage: it shows the reel where its sound is and can’t run longer. Lengthen ' +
        'one of the person’s clips. Nothing was lengthened.',
    );
    expect(await refusal({ ...TWO_BARS, clip: 2 })).toBe(
      'This clip is one held frame of the reel’s footage, not a shot that can run longer. Nothing was lengthened.',
    );
  });

  it('a bar that is not whole frames is rounded once, and the answer says by how much', async () => {
    // A bar of 2.138 s (the owner's real reel): two bars are 128.28 frames, so 128 frames, 9.3 ms short.
    const bars = steadyBars({ barSeconds: 2.138 });
    const { read } = await setup(reelMusicOf(bars));
    const { would } = await read(TWO_BARS);
    expect(would).toMatchObject({ frames: 128, seconds: 4.267, barsSeconds: 4.276, offMs: -9.3 });
    expect(would?.video).toEqual({ fromFrames: 470, toFrames: 598, toSeconds: 19.93 });
    expect(would?.music).toMatchObject({ at: 10.095, backTo: 5.828 });
  });

  it('says so when the video’s music is not the reel’s, or no reel is kept here', async () => {
    const cast = reelWorld(OWNER_WORLD);
    const w = agentWorldOver(cast, { keptAudio: true, reel: reelSource().source });
    const made = await w.call('timeline.assemble', {
      projectId: w.projectId,
      template: { id: cast.template.id },
    });
    const timelineId = ((made.ok ? made.value.timelineIds : []) as string[])[0]!;
    const target = { projectId: w.projectId, timelineId };
    const read = await w.call('timeline.musicBars', target);
    expect(read.ok && read.value.music).toMatchObject({
      measured: false,
      why: 'This video’s template keeps no reel with sound on this Mac, so there is no music to measure.',
      bars: [],
    });
    const done = await w.call('timeline.lengthenSlot', { ...target, ...TWO_BARS });
    expect(done.ok ? '' : done.error.detail).toBe(
      'The reel’s music can’t be measured here: this video’s template keeps no reel with sound on this Mac. ' +
        'Nothing was lengthened.',
    );
  });
});

describe('the tools’ versions (LONG1)', () => {
  it('timeline.musicBars 1.0.0 reads and timeline.lengthenSlot 1.0.0 writes its command', async () => {
    const { w } = await setup();
    const tool = (name: string) => w.tools.tools.find((candidate) => candidate.name === name)!;
    expect(tool('timeline.musicBars')).toMatchObject({ version: '1.0.0', sideEffect: 'read' });
    expect(tool('timeline.lengthenSlot')).toMatchObject({
      version: '1.0.0',
      sideEffect: 'write',
      command: 'timeline.lengthenSlot',
    });
    // MATCH1's tools are as they were: the instant is measured on the clip as long as it is, with no new input.
    expect(tool('timeline.cast').version).toBe('1.6.0');
    expect(tool('timeline.assemble').version).toBe('1.5.0');
  });
});
