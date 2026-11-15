// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: when a clip is lengthened by bars of the music, everything after the splice moves with the music: text,
 * captions, sounds and markers, the beat map and each clip's beat anchor. A video of three clips of 90 frames on
 * beats every 15: clip 1 is made 60 frames longer at frame 75 (2.5 s) or at its end (3 s). Also: a second lengthening,
 * the reel's music chosen again (the cuts stay), and the checks every stored timeline passes.
 */
import {
  CAPTION_PRESETS,
  coverSettingsSchema,
  newId,
  ok,
  RationalTime,
  TimeRange,
  timelineSchema,
  type CaptionTrack,
  type Clip,
  type Marker,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { lengthenSlot, type LengthenInput } from '../src/edits/lengthen';
import { marker } from '../src/model/markers';
import { positions, videoItems } from '../src/model/sequence';
import { checkEdited } from '../src/model/validate';
import { carriedBeatMap, heardAt, reelTimeAt, slotAddedFrames } from '../src/music/carry';
import { withMusic } from '../src/resync/music-beats';
import { memoryTemplateReader } from '../src/service/templates';
import { buildTemplate } from './fixtures/template';
import { buildTimeline, starts } from './fixtures/timeline';

const RATE = { num: 30, den: 1 };
const f = (value: number) => RationalTime.of(value, RATE);
const span = (start: number, frames: number) => TimeRange.of(f(start), f(frames));
const samples = (seconds: number) => RationalTime.of(Math.round(seconds * 48_000), { num: 48_000, den: 1 });

function sound(frames: number): Clip {
  return {
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: { kind: 'audio', assetId: newId<'Asset'>(), available: span(0, 90) },
    sourceStart: f(0),
    duration: f(frames),
    speed: null,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

const cue = (start: number, frames: number) => ({
  id: newId<'CaptionCue'>(),
  range: span(start, frames),
  words: [
    { text: 'one', range: span(start, Math.floor(frames / 2)), confidence: 1 },
    {
      text: 'two',
      range: span(start + Math.floor(frames / 2), frames - Math.floor(frames / 2)),
      confidence: 1,
    },
  ],
  edited: false,
});

/** Three clips of 90 frames (media 600 frames, in at 100) on the reel's music, with text, captions and sounds. */
function world() {
  const built = buildTimeline({
    clips: [{ frames: 90 }, { frames: 90 }, { frames: 90 }],
    texts: [
      { start: 10, frames: 30 },
      { start: 30, frames: 60, track: 1 },
      { start: 80, frames: 10, track: 2 },
      { start: 100, frames: 40, slot: 1 },
    ],
  });
  const template = {
    ...buildTemplate({ slots: [{ frames: 90 }, { frames: 90 }, { frames: 90 }] }),
    beatMap: built.timeline.beatMap,
  };
  const effects: Track = {
    kind: 'audio',
    id: 'A2',
    name: 'Effects',
    enabled: true,
    role: 'sfx',
    items: [
      { type: 'gap', id: newId<'TimelineItem'>(), duration: f(20), slotId: null },
      sound(20),
      { type: 'gap', id: newId<'TimelineItem'>(), duration: f(60), slotId: null },
      sound(30),
    ],
  };
  const captions: CaptionTrack = {
    enabled: true,
    language: 'en',
    style: CAPTION_PRESETS.classic,
    styleSource: 'preset',
    cues: [cue(0, 40), cue(60, 30), cue(120, 30)],
  };
  const markers: Marker[] = [
    marker(newId<'TimelineItem'>(), 'hook', 'timeline.marker.hook', 0, 75, RATE),
    marker(newId<'TimelineItem'>(), 'note', 'a note', 40, 1, RATE),
    marker(newId<'TimelineItem'>(), 'note', 'a later note', 200, 1, RATE),
  ];
  const timeline: Timeline = {
    ...built.timeline,
    template: { id: template.id, version: template.version },
    music: { path: 'referenceAudio', templateId: template.id, gainDb: 0 },
    tracks: [...built.timeline.tracks, effects],
    captions,
    markers,
    // One cover from a frame of the first clip, one from a frame of the third.
    covers: [
      coverSettingsSchema.parse({ aspect: '9:16', source: { kind: 'frame', frame: 70 } }),
      coverSettingsSchema.parse({ aspect: '1:1', source: { kind: 'frame', frame: 200 } }),
    ],
  };
  const lengthen = (input: Partial<LengthenInput>, on = timeline) =>
    lengthenSlot(
      on,
      {
        clipId: built.ids[0]!,
        frames: 60,
        bars: 2,
        at: samples(2.5),
        crossfade: samples(0.05),
        footage: 'after',
        ...input,
      },
      { source: 'agent' },
    );
  return { timeline, template, ids: built.ids, slots: built.slots, lengthen };
}

const texts = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.map((item) => [item.start.value, item.duration.value]) : [],
  );
const cues = (timeline: Timeline) =>
  timeline.captions!.cues.map((item) => [
    item.range.start.value,
    item.range.duration.value,
    ...item.words.map((word) => word.range.start.value),
  ]);
const sounds = (timeline: Timeline) => {
  const track = timeline.tracks.find((item) => item.kind === 'audio');
  return track && track.kind === 'audio'
    ? positions(track.items).flatMap(({ item, start }) =>
        item.type === 'clip' ? [[start, item.duration.value]] : [],
      )
    : [];
};
const coverFrames = (timeline: Timeline) =>
  (timeline.covers ?? []).map((cover) => (cover.source.kind === 'frame' ? cover.source.frame : null));
const marks = (timeline: Timeline) =>
  timeline.markers.map((item) => [item.kind, item.range.start.value, item.range.duration.value]);
const beats = (timeline: Timeline) => timeline.beatMap!.beats.map((beat) => beat.value);
const anchors = (timeline: Timeline) =>
  videoItems(timeline).flatMap((item) => (item.type === 'clip' ? [item.beatAnchor?.beatIndex ?? null] : []));

describe('everything after the splice moves with the music (LONG1)', () => {
  it('text, sounds and markers follow the music from the splice; captions and a cover’s frame follow the picture', () => {
    const { timeline, lengthen } = world();
    expect(texts(timeline)).toEqual([
      [10, 30],
      [100, 40],
      [30, 60],
      [80, 10],
    ]);
    expect(sounds(timeline)).toEqual([
      [20, 20],
      [100, 30],
    ]);
    const done = lengthen({});
    if (!done.ok) throw new Error(done.error.detail);
    const after = done.value.timeline;
    expect(starts(after)).toEqual([0, 150, 240, 330]);
    // Before the splice at frame 75: as it was. Across it: 60 frames longer. From it on: 60 frames later.
    expect(texts(after)).toEqual([
      [10, 30],
      [160, 40],
      [30, 120],
      [140, 10],
    ]);
    // `after`: the clip shows the frames it showed where it showed them, so its cues (and a cover from one of
    // its frames) stay, whole; those of the later clips are 60 frames later.
    expect(cues(after)).toEqual([
      [0, 40, 0, 20],
      [60, 30, 60, 75],
      [180, 30, 180, 195],
    ]);
    expect(coverFrames(after)).toEqual([70, 260]);
    // A sound keeps its length: it moves when it starts at or after the splice.
    expect(sounds(after)).toEqual([
      [20, 20],
      [160, 30],
    ]);
    // The hook marker keeps its length (the opening is as long as it was); notes move like text.
    expect(marks(after)).toEqual([
      ['hook', 0, 75],
      ['note', 40, 1],
      ['note', 260, 1],
    ]);
    expect(done.value).toMatchObject({
      from: 75,
      frames: 60,
      clips: 2,
      reelClips: 0,
      transitions: 0,
      count: { texts: 2, textsLonger: 1, captions: 1, sounds: 1, markers: 1 },
    });
    expect(done.value.changed).toEqual(['tracks', 'markers', 'cast', 'beatMap', 'captions', 'mix', 'covers']);
    expect(checkEdited(after).ok).toBe(true);
  });

  it('a splice at the clip’s end moves only what is on the later clips', () => {
    const { lengthen } = world();
    const done = lengthen({ at: samples(3), footage: 'before' });
    if (!done.ok) throw new Error(done.error.detail);
    const after = done.value.timeline;
    expect(done.value.from).toBe(90);
    expect(texts(after)).toEqual([
      [10, 30],
      [160, 40],
      [30, 60],
      [80, 10],
    ]);
    // `before`: the clip plays 60 more frames of its shot ahead of what it played, so every frame it showed is
    // 60 frames later, and with them its cues and the cover made from one of its frames.
    expect(cues(after)).toEqual([
      [60, 40, 60, 80],
      [120, 30, 120, 135],
      [180, 30, 180, 195],
    ]);
    expect(coverFrames(after)).toEqual([130, 260]);
    expect(done.value.count.captions).toBe(3);
    expect(sounds(after)).toEqual([
      [20, 20],
      [160, 30],
    ]);
    const clip = videoItems(after)[0] as Clip;
    expect([clip.sourceStart.value, clip.duration.value]).toEqual([40, 150]);
  });

  it('the beat map is the music’s: the bars played again have their beats, and each clip names its beat', () => {
    const { timeline, lengthen } = world();
    expect(beats(timeline).slice(0, 8)).toEqual([0, 15, 30, 45, 60, 75, 90, 105]);
    expect(anchors(timeline)).toEqual([0, 6, 12]);
    const done = lengthen({});
    if (!done.ok) throw new Error(done.error.detail);
    const after = done.value.timeline;
    // Beats 0 to 60 stay; from frame 75 the music is the reel's from frame 15 again, so its beats are there again.
    expect(beats(after).slice(0, 12)).toEqual([0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]);
    expect(beats(after)).toHaveLength(beats(timeline).length + 4);
    expect(after.beatMap!.downbeats).toEqual([0]);
    // Clips 2 and 3 start at 150 and 240: the beats they were on, four beats further along the map.
    expect(anchors(after)).toEqual([0, 10, 16]);
    for (const { item, start } of positions(videoItems(after)))
      if (item.type === 'clip' && item.beatAnchor)
        expect(after.beatMap!.beats[item.beatAnchor.beatIndex]!.value + item.beatAnchor.offset.value).toBe(
          start,
        );
  });

  it('a second lengthening counts on the first: the repeats stay in order on the music’s clock', () => {
    const { lengthen, slots } = world();
    const first = lengthen({ at: samples(3), footage: 'before' });
    if (!first.ok) throw new Error(first.error.detail);
    // Now 150 frames long; a splice at 1 s of the video, 30 frames back, before the first one.
    const second = lengthen({ at: samples(1.5), frames: 30, bars: 1 }, first.value.timeline);
    if (!second.ok) throw new Error(second.error.detail);
    const after = second.value.timeline;
    expect(starts(after)).toEqual([0, 180, 270, 360]);
    const repeats = after.mix.musicRepeats!;
    expect(
      repeats.map((repeat) => [RationalTime.toSeconds(repeat.at), repeat.length.value, repeat.bars]),
    ).toEqual([
      [1.5, 30, 1],
      [4, 60, 2],
    ]);
    expect(slotAddedFrames(after).get(slots[0]!)).toBe(90);
    // The reel's second 2 is heard at 2 s, again at 3 s (the first repeat is 1 s back from 1.5 s)... and the
    // reel's second 4 (clip 2's first frame, 120 frames) at 6 s: where clip 2 now starts.
    expect(heardAt(repeats, 1)).toEqual([1, 2, 4]);
    expect(heardAt(repeats, 3)).toEqual([6]);
    expect(reelTimeAt(repeats, 6)).toBe(3);
    expect(reelTimeAt(repeats, 1.6)).toBeCloseTo(0.6);
    expect(checkEdited(after).ok).toBe(true);
    expect(timelineSchema.safeParse(after).success).toBe(true);
  });

  it('choosing the reel’s music again keeps the cuts: the grid to go back to is the carried one', async () => {
    const { timeline, template, lengthen } = world();
    const done = lengthen({});
    if (!done.ok) throw new Error(done.error.detail);
    const after = done.value.timeline;
    expect(after.beatMap).toEqual(carriedBeatMap(template.beatMap!, after.mix.musicRepeats!));
    const templates = memoryTemplateReader([template]);
    const again = await withMusic(after, timeline.music, { templates });
    expect(again.ok && again.value.retimed).toBe(false);
    expect(again.ok && starts(again.value.timeline)).toEqual([0, 150, 240, 330]);
    // An own track still moves the cuts, and the picture keeps its length's worth of clips.
    const own = await withMusic(
      after,
      { path: 'ownTrack', assetId: newId<'Asset'>(), offset: f(0), gainDb: 0 },
      { templates, trackBeats: async () => ok({ ...template.beatMap!, beats: [0, 20, 40, 60, 80].map(f) }) },
    );
    expect(own.ok && own.value.retimed).toBe(true);
    expect(own.ok && own.value.timeline.mix.musicRepeats).toEqual(after.mix.musicRepeats);
  });

  it('refuses a locked clip for an agent, music that is not the reel’s, and music that was moved', () => {
    const { timeline, lengthen, ids } = world();
    const locked = {
      ...timeline,
      tracks: timeline.tracks.map((track, index) =>
        index === 0 && track.kind === 'video'
          ? {
              ...track,
              items: track.items.map((item) => (item.id === ids[0] ? { ...item, locked: true } : item)),
            }
          : track,
      ),
    } as Timeline;
    const agent = lengthen({}, locked);
    expect(agent.ok ? '' : agent.error.code).toBe('timeline.clip_locked');
    const other = lengthen({}, { ...timeline, music: { path: 'platformSound' } });
    expect(other.ok ? '' : other.error.detail).toBe(
      'The video’s music is not the reel’s own (music: platformSound): only the reel’s music can play bars again, so nothing was lengthened.',
    );
    const moved = lengthen({}, {
      ...timeline,
      mix: { ...timeline.mix, music: { ...MUSIC_BED, shift: f(15) } },
    } as Timeline);
    expect(moved.ok ? '' : moved.error.detail).toBe(
      'The music was moved 0.5 s against the picture (audio.move): bars are counted on the reel’s own time. Move it back, then lengthen.',
    );
  });
});

const MUSIC_BED = { start: f(0), end: null, shift: f(0), fadeIn: f(0), fadeOut: f(0), muted: false };
