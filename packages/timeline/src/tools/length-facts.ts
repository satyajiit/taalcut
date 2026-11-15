// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the facts a video is lengthened by, in numbers, and what a stated lengthening would do. Nothing here
 * decides: whether the video should be longer, which clip, by how many bars and where the music repeats are the
 * AI's to state (tools/lengthen-tools.ts reports these and applies the statement).
 *
 * - The music: the reel's bars as this video hears them (a bar played again is there twice), the changes, and
 *   how sure the measurement is (reel-music.ts).
 * - Each clip: where it sits, how long it is, and how much of its shot's file lies before and after what it plays
 *   (footage a longer slot would show); the instant on its cut where its slot states one (MATCH1).
 * - A statement, read exactly: whole bars, at a bar line, the length rounded to whole frames once. `planLengthen`
 *   runs the edit itself without writing it, so what it answers is what the write does, and a refusal is the
 *   edit's own with its numbers.
 */
import {
  FrameRate,
  RationalTime,
  TimeRange,
  type Clip,
  type LengthenFootage,
  type SlotEdge,
  type Template,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { lengthenSlot, type Lengthened, type LengthenInput } from '../edits/lengthen';
import { positions, videoItems } from '../model/sequence';
import { consumedMedia, sourceFrames } from '../model/speed';
import { heardAt, reelTimeAt, repeatsOf, slotAddedFrames } from '../music/carry';
import { numberedClips } from './clip-refs';
import { landingFrame } from './landed-moments';
import type { ReelBars, ReelMusic, ReelSeam } from './reel-music';

/** How a repeat is spliced: the same for every one, so a stated bar line is all that places it. */
export const SPLICE = {
  /** The crossfade into the bars played again. */
  crossfadeSeconds: 0.05,
  /** The crossfade ends this long before the bar line, so the bar's first attack is whole. */
  leadSeconds: 0.005,
  /** A stated time within this of a measured bar line is that bar line (a time read back to two decimals). */
  barLineSeconds: 0.01,
  sampleRate: 48_000,
} as const;

const s2 = (seconds: number) => Math.round(seconds * 100) / 100;
const s3 = (seconds: number) => Math.round(seconds * 1000) / 1000;

export interface ClipLength {
  /** The clip's number, as timeline.get numbers it. */
  readonly clip: number;
  readonly clipId: string;
  /** Its slot's number in the template; null when it fills none. */
  readonly slot: number | null;
  /** Where it sits in the video, in seconds, and its length in frames. */
  readonly from: number;
  readonly to: number;
  readonly frames: number;
  /** The reel's own footage: it sits where its sound is and can't run longer. */
  readonly reel?: true;
  /** Frames it already runs longer than the reel's slot (bars played again for it). */
  readonly longerBy?: number;
  /**
   * Its shot's file in seconds: the whole of it, the part the clip plays, and how much lies before and after that
   * part (footage the clip does not show).
   */
  readonly shot?: {
    readonly from: number;
    readonly to: number;
    readonly playsFrom: number;
    readonly playsTo: number;
    readonly before: number;
    readonly after: number;
  };
  /** MATCH1: the instant of the shot that sits on the slot's cut now, where the slot states one. */
  readonly lands?: { readonly edge: SlotEdge; readonly shotSeconds: number; readonly videoSeconds: number };
}

function landsOf(
  clip: Clip,
  start: number,
  template: Template | null,
  fps: number,
): ClipLength['lands'] | undefined {
  const index = template?.slots.findIndex((slot) => slot.id === clip.slotId) ?? -1;
  const slot = template?.slots[index];
  if (!template || !slot?.lands || clip.media.kind !== 'video') return undefined;
  const landing = landingFrame(template, index, slot.lands.edge, clip.duration.value);
  return {
    edge: slot.lands.edge,
    shotSeconds: s2(RationalTime.toSeconds(clip.sourceStart) + sourceFrames(clip.speed, landing) / fps),
    videoSeconds: s2((start + landing) / fps),
  };
}

/** Every clip of the video, as timeline.get numbers them, with its length and its shot's unused footage. */
export function clipLengths(timeline: Timeline, template: Template | null): ClipLength[] {
  const rate = timeline.canvas.rate;
  const fps = FrameRate.toNumber(rate);
  const numbers = new Map(numberedClips(timeline).map((clip) => [clip.id, clip.number]));
  const kept = new Set(
    (timeline.cast?.slots ?? []).flatMap((slot) =>
      slot.note === 'reelKept' && slot.clipId ? [slot.clipId] : [],
    ),
  );
  const added = slotAddedFrames(timeline);
  return positions(videoItems(timeline)).flatMap(({ item, start, end }): ClipLength[] => {
    if (item.type !== 'clip') return [];
    const slotIndex = template?.slots.findIndex((slot) => slot.id === item.slotId) ?? -1;
    // A held frame of the reel (a redrawn dissolve's far side) is the reel's own too.
    const reel = kept.has(item.id) || item.holdFrame !== undefined;
    const longerBy = item.slotId ? added.get(item.slotId) : undefined;
    const lands = reel ? undefined : landsOf(item, start, template, fps);
    let shot: ClipLength['shot'];
    if (item.media.kind === 'video' && !reel) {
      const { available } = item.media;
      const from = RationalTime.toSeconds(available.start);
      const to = RationalTime.toSeconds(TimeRange.end(available));
      const playsFrom = RationalTime.toSeconds(item.sourceStart);
      const playsTo = playsFrom + RationalTime.toSeconds(consumedMedia(item, available.start.rate, rate));
      shot = {
        from: s2(from),
        to: s2(to),
        playsFrom: s2(playsFrom),
        playsTo: s2(playsTo),
        before: s2(Math.max(0, playsFrom - from)),
        after: s2(Math.max(0, to - playsTo)),
      };
    }
    return [
      {
        clip: numbers.get(item.id) ?? 0,
        clipId: item.id,
        slot: slotIndex >= 0 ? slotIndex + 1 : null,
        from: s2(start / fps),
        to: s2(end / fps),
        frames: end - start,
        ...(reel ? { reel: true as const } : {}),
        ...(longerBy ? { longerBy } : {}),
        ...(shot ? { shot } : {}),
        ...(lands ? { lands } : {}),
      },
    ];
  });
}

export interface HeardBar {
  /** The bar line in the video, in seconds. */
  readonly at: number;
  readonly levelDb: number;
  readonly fromBarBefore: number | null;
  /** This bar is one played again: the same bar of the reel sounded earlier in the video. */
  readonly again?: true;
}

/** The reel's bar lines as the video hears them: each where it sounds, a bar played again listed each time. */
export function heardBars(timeline: Timeline, bars: ReelBars): HeardBar[] {
  const repeats = repeatsOf(timeline);
  return bars.bars
    .flatMap((bar) =>
      heardAt(repeats, bar.at).map((at, pass): HeardBar => ({
        at: s3(at),
        levelDb: bar.levelDb,
        fromBarBefore: bar.fromBarBefore,
        ...(pass > 0 ? { again: true as const } : {}),
      })),
    )
    .sort((a, b) => a.at - b.at);
}

export interface LengthenStatement {
  readonly clipId: TimelineItemId;
  readonly bars: number;
  /** Where the music goes back, in seconds of the video: a bar line. */
  readonly at: number;
  readonly footage: LengthenFootage;
}

export interface LengthenWould {
  /** The frames added, the one number for picture and sound, and the same in seconds. */
  readonly frames: number;
  readonly seconds: number;
  /** The bars as measured, in seconds, and how far the whole frames are from them, in ms (+: longer). */
  readonly barsSeconds: number;
  readonly offMs: number;
  readonly video: { readonly fromFrames: number; readonly toFrames: number; readonly toSeconds: number };
  readonly music: {
    /** Where it goes back, in the video, and the time of the reel it plays again from. */
    readonly at: number;
    readonly backTo: number;
    readonly crossfadeMs: number;
    readonly seam: ReelSeam;
  };
  /** The lengthened clip after it. */
  readonly clip: ClipLength;
  /** What starts later by `frames`, and from when in the video. */
  readonly later: {
    readonly fromSeconds: number;
    readonly clips: number;
    readonly reelClips: number;
    readonly transitions: number;
    readonly texts: number;
    readonly textsLonger: number;
    readonly captions: number;
    readonly sounds: number;
    readonly markers: number;
  };
}

export type LengthenPlan =
  | {
      readonly ok: true;
      readonly input: LengthenInput;
      readonly edited: Lengthened;
      readonly would: LengthenWould;
    }
  | { readonly ok: false; readonly why: string };

const cannot = (why: string): LengthenPlan => ({ ok: false, why });

/** The two bar lines nearest a time, for a refusal that shows what could be stated instead. */
function nearest(bars: readonly HeardBar[], at: number): string {
  const sorted = [...bars].sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at)).slice(0, 2);
  return sorted
    .sort((a, b) => a.at - b.at)
    .map((bar) => `${bar.at} s`)
    .join(' and ');
}

/**
 * A statement read exactly, without writing: the frames (the bars' length, rounded to whole frames once), the
 * splice at the stated bar line, and the edit run on a copy. A refusal says why, with the numbers.
 */
export function planLengthen(
  timeline: Timeline,
  template: Template | null,
  music: ReelMusic | null,
  statement: LengthenStatement,
): LengthenPlan {
  if (!music)
    return cannot(
      'The reel’s music can’t be measured here: this video’s template keeps no reel with sound on this Mac. Nothing was lengthened.',
    );
  const { bars } = music;
  if (!bars.steady || bars.barSeconds === null)
    return cannot(
      `No steady bars were found in the reel’s music. ${bars.why ?? ''} Nothing was lengthened.`.replace(
        '  ',
        ' ',
      ),
    );
  const rate = timeline.canvas.rate;
  const fps = FrameRate.toNumber(rate);
  const heard = heardBars(timeline, bars);
  const line = heard.find((bar) => Math.abs(bar.at - statement.at) <= SPLICE.barLineSeconds);
  if (!line)
    return cannot(
      `${statement.at} s is not a bar line of the music: the nearest are ${nearest(heard, statement.at)} ` +
        `(a bar is ${s3(bars.barSeconds)} s). Nothing was lengthened.`,
    );
  const barsSeconds = statement.bars * bars.barSeconds;
  const frames = Math.round(barsSeconds * fps);
  if (frames < 1)
    return cannot(`${statement.bars} bar(s) are ${s3(barsSeconds)} s: under one frame of the video.`);
  const samples = { num: SPLICE.sampleRate, den: 1 };
  const at = RationalTime.fromSeconds(line.at - SPLICE.leadSeconds, samples);
  const input: LengthenInput = {
    clipId: statement.clipId,
    frames,
    bars: statement.bars,
    at,
    crossfade: RationalTime.fromSeconds(SPLICE.crossfadeSeconds, samples),
    footage: statement.footage,
  };
  const edited = lengthenSlot(timeline, input, { source: 'agent' });
  if (!edited.ok) return cannot(`${edited.error.detail ?? edited.error.code} Nothing was lengthened.`);
  const before = positions(videoItems(timeline)).at(-1)?.end ?? 0;
  const clip = clipLengths(edited.value.timeline, template).find((item) => item.clipId === statement.clipId);
  if (!clip) return cannot('The clip is not in the video.');
  const reelAt = reelTimeAt(repeatsOf(timeline), RationalTime.toSeconds(at));
  const back = frames / fps;
  return {
    ok: true,
    input,
    edited: edited.value,
    would: {
      frames,
      seconds: s3(back),
      barsSeconds: s3(barsSeconds),
      offMs: Math.round((back - barsSeconds) * 10_000) / 10,
      video: { fromFrames: before, toFrames: before + frames, toSeconds: s2((before + frames) / fps) },
      music: {
        at: s3(RationalTime.toSeconds(at)),
        backTo: s3(reelAt - back),
        crossfadeMs: Math.round(SPLICE.crossfadeSeconds * 1000),
        seam: music.seam(reelAt, back),
      },
      clip,
      later: {
        fromSeconds: s2(edited.value.from / fps),
        clips: edited.value.clips,
        reelClips: edited.value.reelClips,
        transitions: edited.value.transitions,
        ...edited.value.count,
      },
    },
  };
}
