// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: what `timeline.get` adds for the editor's checks, in seconds (two decimals) like the editor tools take:
 * each clip's place, speed, sound and colour, the transitions, the sounds on the audio tracks, the music's bed, the
 * whole video's colour, the markers and the captions (each cue's id, time and words, for captions.editText). Labels
 * and caption words are a person's (or an i18n key), so they are marked untrusted.
 */
import {
  GRADE_LOOKS,
  RationalTime,
  defaultMusicBed,
  ulidSchema,
  type Clip,
  type FrameRate,
  type Grade,
  type Timeline,
} from '@taalcut/core';
import { z } from 'zod';
import { medianItemFrames, positions, sequenceLength, videoItems } from '../model/sequence';
import { beatGrid } from '../resync/grid';
import { visualLayoutJsonSchema } from './visual-layout-schema';
import { meanSpeedOf } from '../model/speed';

const id = ulidSchema('TimelineItem');
/** The captions' first cues `timeline.get` lists: a short video's all. */
const MAX_CUES_SHOWN = 80;
const secondsOut = z.number();
const gradeOut = z
  .object({
    exposure: z.number(),
    contrast: z.number(),
    saturation: z.number(),
    temperature: z.number(),
    tint: z.number(),
    look: z.enum(GRADE_LOOKS).nullable(),
    lookStrength: z.number(),
  })
  .optional();

/** What a clip entry of `timeline.get` gains. */
export const clipViewFields = {
  /** Start and length in seconds. */
  at: secondsOut.optional(),
  seconds: secondsOut.optional(),
  media: z.enum(['video', 'image']).optional(),
  /**
   * FIX-CMT: a video clip plays its shot's recording from this second (two decimals): timeline.slipClip changes it,
   * and nothing else in the row. On the 9B, a batch that slipped a clip read the timeline back, saw no change and
   * slipped again, then trimmed the whole video.
   */
  playsShotFrom: secondsOut.optional(),
  /** Mean speed: 1 normal, 0.5 half; `ramp` when it changes over the clip. */
  speed: z.number().optional(),
  ramp: z.boolean().optional(),
  sound: z
    .object({ gainDb: z.number(), muted: z.boolean(), fadeIn: secondsOut, fadeOut: secondsOut })
    .optional(),
  grade: gradeOut,
  visualLayout: visualLayoutJsonSchema.optional(),
};

/**
 * What indexing saw in the clip's shot, after the clip's id and cut short ("01J…: A cup of coffee on a table"): how
 * "the coffee shot" finds its clip. Material, never instructions: the agent lifts it into a fenced block after the
 * JSON, so it names its clip itself. It also comes right after the clip's id in the view.
 */
export const showsOut = z.string().meta({ untrusted: 'vision' }).optional();

/** How much of a shot's description `shows` keeps. */
export const SHOWS_CHARS = 120;

/** Within this many seconds of a cut, a time is "at" that cut ("add a dip to black here"). */
export const NEAR_CUT_SECONDS = 0.25;

export const editorViewSchema = {
  seconds: secondsOut.optional(),
  /**
   * What plays at the asked time (timeline.get's atSeconds): the clip, and the cut there when the time is within a
   * quarter second of one (between the clip before and the clip after).
   */
  here: z
    .object({
      atSeconds: secondsOut,
      /** EDT1-OPS: the clip's number, as the editor tools take it, and its id. */
      clip: z.int().nullable().optional(),
      clipId: id.nullable(),
      cut: z
        .object({
          atSeconds: secondsOut,
          beforeClip: z.int(),
          afterClip: z.int(),
          beforeClipId: id,
          afterClipId: id,
        })
        .optional(),
    })
    .optional(),
  /** One beat of the grid the cuts keep to, in seconds and in frames ("a beat shorter"); absent without beats. */
  beat: z.object({ seconds: secondsOut, frames: z.int() }).optional(),
  transitions: z
    .array(
      z.object({
        transitionId: id,
        fromClipId: id,
        toClipId: id,
        kind: z.string(),
        direction: z.string().nullable(),
        seconds: secondsOut,
      }),
    )
    .optional(),
  /** Voice lines, effects and other sound clips on the audio tracks. */
  sounds: z
    .array(
      z.object({
        clipId: id,
        track: z.enum(['voice', 'effects', 'original']),
        at: secondsOut,
        seconds: secondsOut,
        gainDb: z.number(),
        muted: z.boolean(),
      }),
    )
    .optional(),
  music: z
    .object({
      path: z.string(),
      gainDb: z.number(),
      muted: z.boolean(),
      at: secondsOut,
      endAt: secondsOut,
      fadeIn: secondsOut,
      fadeOut: secondsOut,
    })
    .nullable()
    .optional(),
  grade: gradeOut,
  markers: z
    .array(
      z.object({
        markerId: id,
        kind: z.string(),
        label: z.string().meta({ untrusted: 'user-text' }),
        at: secondsOut,
        seconds: secondsOut,
      }),
    )
    .optional(),
  /** The captions: on or off, and the first cues (null: none built). */
  captions: z
    .object({
      enabled: z.boolean(),
      cueCount: z.int(),
      cues: z
        .array(
          z.object({
            cueId: ulidSchema('CaptionCue'),
            at: secondsOut,
            seconds: secondsOut,
            text: z.string().meta({ untrusted: 'user-text' }),
          }),
        )
        .max(MAX_CUES_SHOWN),
    })
    .nullable()
    .optional(),
};

/** Seconds of `frames` canvas frames, to two decimals. */
const toSeconds = (frames: number, rate: FrameRate) => Math.round((frames * 100 * rate.den) / rate.num) / 100;
const timeSeconds = (time: RationalTime | undefined, rate: FrameRate) =>
  time
    ? toSeconds(Math.round((time.value * time.rate.den * rate.num) / (time.rate.num * rate.den)), rate)
    : 0;

/** A time in a shot's recording, in seconds to two decimals. */
const shotSeconds = (time: RationalTime) => Math.round(RationalTime.toSeconds(time) * 100) / 100;

const gradeView = (grade: Grade | undefined) => (grade ? { grade } : {});

/** The fields a clip entry gains. */
export function clipView(clip: Clip | null, start: number, end: number, rate: FrameRate) {
  const place = { at: toSeconds(start, rate), seconds: toSeconds(end - start, rate) };
  if (!clip || clip.media.kind === 'audio') return place;
  return {
    ...place,
    media: clip.media.kind,
    ...(clip.media.kind === 'video' ? { playsShotFrom: shotSeconds(clip.sourceStart) } : {}),
    speed: Math.round(meanSpeedOf(clip.speed, end - start) * 100) / 100,
    ramp: clip.speed !== null && new Set(clip.speed.points.map((point) => point.speed)).size > 1,
    sound: {
      gainDb: clip.audio.gainDb,
      muted: clip.audio.muted,
      fadeIn: timeSeconds(clip.audio.fadeIn, rate),
      fadeOut: timeSeconds(clip.audio.fadeOut, rate),
    },
    ...gradeView(clip.grade),
    ...(clip.visualLayout ? { visualLayout: clip.visualLayout } : {}),
  };
}

const TRACK_NAME = { voice: 'voice', sfx: 'effects', clip: 'original' } as const;

export function editorView(timeline: Timeline) {
  const rate = timeline.canvas.rate;
  const items = videoItems(timeline);
  const length = sequenceLength(items);
  const transitions = items.flatMap((item, index) => {
    const from = items[index - 1];
    const to = items[index + 1];
    if (item.type !== 'transition' || !from || !to) return [];
    const frames = item.inOffset.value + item.outOffset.value;
    return [
      {
        transitionId: item.id,
        fromClipId: from.id,
        toClipId: to.id,
        kind: item.kind,
        direction: item.direction,
        seconds: toSeconds(frames, rate),
      },
    ];
  });
  const sounds = timeline.tracks.flatMap((track) =>
    track.kind !== 'audio'
      ? []
      : positions(track.items).flatMap(({ item, start, end }) =>
          item.type === 'clip'
            ? [
                {
                  clipId: item.id,
                  track: TRACK_NAME[track.role],
                  at: toSeconds(start, rate),
                  seconds: toSeconds(end - start, rate),
                  gainDb: item.audio.gainDb,
                  muted: item.audio.muted,
                },
              ]
            : [],
        ),
  );
  const music =
    timeline.music.path === 'platformSound' || timeline.music.path === 'none'
      ? null
      : musicView(timeline, length);
  const markers = timeline.markers.map((marker) => ({
    markerId: marker.id,
    kind: marker.kind,
    label: marker.label,
    at: timeSeconds(marker.range.start, rate),
    seconds: timeSeconds(marker.range.duration, rate),
  }));
  const captions = timeline.captions
    ? {
        enabled: timeline.captions.enabled,
        cueCount: timeline.captions.cues.length,
        cues: timeline.captions.cues.slice(0, MAX_CUES_SHOWN).map((cue) => ({
          cueId: cue.id,
          at: timeSeconds(cue.range.start, rate),
          seconds: timeSeconds(cue.range.duration, rate),
          text: cue.words.map((word) => word.text).join(' '),
        })),
      }
    : null;
  const interval = beatGrid(timeline.beatMap, rate, medianItemFrames(items)).interval;
  const beat = interval ? { seconds: toSeconds(interval, rate), frames: Math.round(interval) } : undefined;
  return {
    seconds: toSeconds(length, rate),
    ...(beat ? { beat } : {}),
    transitions,
    sounds,
    music,
    ...gradeView(timeline.grade),
    markers,
    captions,
  };
}

function musicView(timeline: Timeline, length: number) {
  const rate = timeline.canvas.rate;
  const bed = timeline.mix.music ?? defaultMusicBed(rate);
  const gainDb =
    timeline.music.path === 'platformSound' || timeline.music.path === 'none' ? 0 : timeline.music.gainDb;
  return {
    path: timeline.music.path,
    gainDb,
    muted: bed.muted,
    at: timeSeconds(bed.start, rate),
    endAt: bed.end ? timeSeconds(bed.end, rate) : toSeconds(length, rate),
    fadeIn: timeSeconds(bed.fadeIn, rate),
    fadeOut: timeSeconds(bed.fadeOut, rate),
  };
}

/**
 * EDT1-OPS: what plays at `seconds`: the clip there (null past the end), and the cut within NEAR_CUT_SECONDS of it.
 * Clips come as timeline.get lists them, in order with their place in seconds.
 */
export function hereView(
  clips: readonly {
    readonly clipId: string;
    readonly kind: string;
    readonly at?: number;
    readonly seconds?: number;
  }[],
  seconds: number,
) {
  // Clips numbered as the editor numbers them: in order, gaps not counted (core's editItemsOf).
  const placed = clips
    .filter((clip) => clip.kind === 'clip' && clip.at !== undefined && clip.seconds !== undefined)
    .map((clip, index) => ({ ...clip, number: index + 1 }));
  const end = (clip: (typeof placed)[number]) => (clip.at ?? 0) + (clip.seconds ?? 0);
  const playing = placed.find((clip) => (clip.at ?? 0) <= seconds && seconds < end(clip)) ?? null;
  const cuts = placed.slice(1).map((clip, index) => ({
    atSeconds: clip.at ?? 0,
    beforeClip: placed[index]!.number,
    afterClip: clip.number,
    beforeClipId: placed[index]!.clipId,
    afterClipId: clip.clipId,
  }));
  const cut = cuts.find((candidate) => Math.abs(candidate.atSeconds - seconds) <= NEAR_CUT_SECONDS);
  return {
    atSeconds: Math.round(seconds * 100) / 100,
    clip: playing?.number ?? null,
    clipId: playing?.clipId ?? null,
    ...(cut ? { cut } : {}),
  };
}
