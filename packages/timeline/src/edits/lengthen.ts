// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: `timeline.lengthenSlot`'s edit. One of the person's clips runs `frames` longer, the reel's music plays
 * that much of itself again (core's music-repeats.ts), and everything from the splice on is `frames` later: the
 * later clips, the transitions and the reel's own clips by V1's order, and text, graphics, captions, sounds,
 * markers and a cover's frame through one insertion of time (time-insert.ts). A kept reel clip keeps its in-point, so it shows the
 * reel's frames under the music they had in the reel. The beat map is the music's: the bars played again have
 * their beats, and each later clip's anchor names its beat where it is now.
 *
 * It applies what it is given and never rounds, snaps or chooses. What can't be done is refused with the numbers:
 * a clip that is not the person's (the reel's own footage, a held frame), music that is not the reel's or was
 * moved, a splice outside the lengthened clip, less music before the splice than it goes back, a shot without
 * that much footage on the side stated. Pure; the caller states whole bars (tools/lengthen-tools.ts measures them).
 */
import {
  err,
  FrameRate,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type Clip,
  type LengthenFootage,
  type MusicRepeat,
  type Result,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { InvalidMove } from '../errors';
import { updateSlots } from '../model/cast';
import { trimEnd, trimStart } from '../model/clip-edit';
import { medianItemFrames, positions, videoItems, withVideoItems } from '../model/sequence';
import { clipMediaFits, consumedMedia } from '../model/speed';
import { carryBeats, reelTimeAt, repeatsOf, withRepeat } from '../music/carry';
import { anchorAt, anchorFrame, beatGrid } from '../resync/grid';
import { resync } from '../resync/resync';
import { insertTime, type InsertionCount } from './time-insert';
import { clipPosition, type EditOptions, type EditResult } from './types';

export interface LengthenInput {
  readonly clipId: TimelineItemId;
  /** Whole frames added to the clip, and how far back the music goes. */
  readonly frames: number;
  readonly bars: number;
  /** Where the music goes back, on the music's clock (core's `musicRepeatSchema.at`). */
  readonly at: RationalTime;
  readonly crossfade: RationalTime;
  readonly footage: LengthenFootage;
}

export interface Lengthened extends EditResult {
  /** The first frame that moved, and by how many. */
  readonly from: number;
  readonly frames: number;
  /** What moved later, beside V1. */
  readonly count: InsertionCount;
  /** V1 after the lengthened clip: the clips that start later, how many of them are the reel's own, the transitions. */
  readonly clips: number;
  readonly reelClips: number;
  readonly transitions: number;
}

const refused = (detail: string) => err(InvalidMove(undefined, { detail }));
const s2 = (seconds: number) => Math.round(seconds * 100) / 100;

/** Why the shot has no more footage on the side stated, with how much it has. */
function footageRefusal(clip: Clip, input: LengthenInput, rate: FrameRate): string {
  if (clip.media.kind === 'image') return 'A photo has no more footage.';
  const { available } = clip.media;
  const fps = FrameRate.toNumber(rate);
  const before = RationalTime.toSeconds(RationalTime.subtract(clip.sourceStart, available.start));
  const used = consumedMedia(clip, available.start.rate, rate);
  const after = RationalTime.toSeconds(
    RationalTime.subtract(TimeRange.end(available), RationalTime.add(clip.sourceStart, used)),
  );
  const has = input.footage === 'before' ? before : after;
  return (
    `${input.frames} frames (${s2(input.frames / fps)} s) of the shot ${input.footage} what the clip plays are ` +
    `needed, and its file has ${s2(Math.max(0, has))} s there ` +
    `(${s2(Math.max(0, before))} s before, ${s2(Math.max(0, after))} s after).`
  );
}

/** Each clip's anchor on the carried beats: kept while it still lands within a frame, else the beat nearest it. */
function withAnchors(timeline: Timeline, items: readonly SequenceItem[]): SequenceItem[] {
  const rate = timeline.canvas.rate;
  const grid = beatGrid(timeline.beatMap, rate, medianItemFrames(items));
  const out = [...items];
  for (const { item, itemIndex, start } of positions(items)) {
    if (item.type !== 'clip' || !item.beatAnchor) continue;
    const lands = anchorFrame(grid, item.beatAnchor);
    if (lands !== null && Math.abs(lands - start) <= 1) continue;
    out[itemIndex] = { ...item, beatAnchor: anchorAt(grid, start, rate) };
  }
  return out;
}

export function lengthenSlot(
  timeline: Timeline,
  input: LengthenInput,
  options: EditOptions,
): Result<Lengthened> {
  const rate = timeline.canvas.rate;
  const fps = FrameRate.toNumber(rate);
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const clip = found.value.item;
  const slot = timeline.cast?.slots.find((item) => item.clipId === clip.id);
  if (slot?.note === 'reelKept')
    return refused(
      'This clip is the reel’s own footage: it shows the reel where its sound is and can’t run longer. Lengthen one of the person’s clips.',
    );
  if (clip.holdFrame)
    return refused('This clip is one held frame of the reel’s footage, not a shot that can run longer.');
  if (timeline.music.path !== 'referenceAudio')
    return refused(
      `The video’s music is not the reel’s own (music: ${timeline.music.path}): only the reel’s music can play bars again, so nothing was lengthened.`,
    );
  const shift = timeline.mix.music?.shift;
  if (shift && shift.value !== 0)
    return refused(
      `The music was moved ${s2(RationalTime.toSeconds(shift))} s against the picture (audio.move): bars are counted on the reel’s own time. Move it back, then lengthen.`,
    );

  // The splice lies inside the clip as it will be: after its start by the crossfade, and not past its new end.
  const first = RationalTime.of(found.value.start, rate);
  const last = RationalTime.of(found.value.end + input.frames, rate);
  const fadeFrom = RationalTime.subtract(input.at, input.crossfade);
  if (RationalTime.compare(fadeFrom, first) < 0 || RationalTime.compare(input.at, last) > 0)
    return refused(
      `The music can go back between ${s2(found.value.start / fps + RationalTime.toSeconds(input.crossfade))} s and ` +
        `${s2((found.value.end + input.frames) / fps)} s of the video (inside this clip once it is ${input.frames} frames longer): ` +
        `${s2(RationalTime.toSeconds(input.at))} s is outside it, and a clip before or after it would leave its music.`,
    );
  const repeats = repeatsOf(timeline);
  const back = input.frames / fps;
  const reelAt = reelTimeAt(repeats, RationalTime.toSeconds(input.at));
  const needed = back + RationalTime.toSeconds(input.crossfade);
  if (reelAt - needed < -1e-9)
    return refused(
      `The music has ${s2(reelAt)} s before this point and goes back ${s2(needed)} s (${input.frames} frames and the crossfade): not enough music before it to play again.`,
    );

  const longer =
    input.footage === 'before' ? trimStart(clip, -input.frames, rate) : trimEnd(clip, input.frames, rate);
  if (!clipMediaFits(longer, rate)) return refused(footageRefusal(clip, input, rate));

  // What follows the music moves from the first frame at or after the splice (the frames after the clip always
  // move); what follows the picture, from the clip's first frame or the frame after its last.
  const from = Math.min(Math.ceil(RationalTime.toSeconds(input.at) * fps - 1e-9), found.value.end);
  const picture = input.footage === 'before' ? found.value.start : found.value.end;
  const ids = options.ids ?? (() => newId<'TimelineItem'>());
  const moved = insertTime(timeline, { at: from, picture, frames: input.frames }, ids);
  const repeat: MusicRepeat = {
    at: input.at,
    length: RationalTime.of(input.frames, rate),
    crossfade: input.crossfade,
    bars: input.bars,
    slotId: clip.slotId,
  };
  const beatMap = timeline.beatMap ? carryBeats(timeline.beatMap, repeat) : null;
  const items = [...videoItems(timeline)];
  items[found.value.itemIndex] = longer;
  const cast = updateSlots(moved.timeline.cast, (item) =>
    item.clipId === clip.id && item.pick
      ? { ...item, pick: { ...item.pick, sourceStart: longer.sourceStart } }
      : item,
  );
  const carried: Timeline = {
    ...moved.timeline,
    cast,
    beatMap,
    mix: { ...moved.timeline.mix, musicRepeats: withRepeat(repeats, repeat) },
  };
  const edited = withVideoItems(carried, withAnchors(carried, items));
  const synced = resync(edited, { ...(options.config ? { config: options.config } : {}), ids });
  const after = videoItems(timeline).slice(found.value.itemIndex + 1);
  const kept = new Set(
    (timeline.cast?.slots ?? []).flatMap((item) =>
      item.note === 'reelKept' && item.clipId ? [item.clipId] : [],
    ),
  );
  return ok({
    timeline: synced,
    changed: [
      'tracks',
      'markers',
      'cast',
      'beatMap',
      'captions',
      'mix',
      ...(timeline.covers ? ['covers' as const] : []),
    ],
    from,
    frames: input.frames,
    count: moved.count,
    clips: after.filter((item) => item.type === 'clip').length,
    reelClips: after.filter(
      (item) => item.type === 'clip' && (kept.has(item.id) || item.holdFrame !== undefined),
    ).length,
    transitions: after.filter((item) => item.type === 'transition').length,
  });
}
