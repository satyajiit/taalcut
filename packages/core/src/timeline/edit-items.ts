// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1: every item of a timeline a person can point at, as an edit target with its place on the timeline. The
 * editor's chips, the agent's reading of "this" and "the second clip", and the changes card's rows all number and
 * place items the same way: clips 1, 2, 3 in V1's order (gaps and transitions don't count), every other kind in
 * time order. Times are whole frames at the canvas rate.
 */
import type { TimelineId } from '../basics/ids';
import type { FrameRate } from '../time/frame-rate-value';
import { RationalTime } from '../time/rational-time';
import {
  EDIT_ITEM_KINDS,
  editTargetJsonSchema,
  parseEditTarget,
  type EditItemKind,
  type EditItemTarget,
  type EditTarget,
} from './edit-target';
import { compositionFor, type GraphicComposition } from '../workspace/composition';
import type { GraphicItem } from './graphics';
import type { SequenceItem, Track } from './timeline-items';
import type { Timeline } from './timeline-schema';

export interface EditItemPlace {
  readonly target: EditItemTarget;
  /** First frame on the timeline, and the first frame after it. A transition spans the frames it blends. */
  readonly start: number;
  readonly end: number;
  /** 1-based among the timeline's items of its kind: "Clip 3", "Text 2". */
  readonly number: number;
  /** The track it is on (V1, A2, T1); null for a caption. */
  readonly trackId: string | null;
  /** Its own words: a text's, a caption's, a graphic's main line; null for media and transitions. */
  readonly words: string | null;
}

const frames = (time: RationalTime, rate: FrameRate) => RationalTime.toFrames(time, rate);

/**
 * A graphic's main line of words, when it has one: its composition's first text variable's value (else that
 * variable's sample), read from the timeline's copy of it; null without the copy.
 */
export function graphicWords(
  graphic: Pick<GraphicItem, 'composition'>,
  compositions?: readonly GraphicComposition[],
): string | null {
  const ref = graphic.composition;
  const text = compositionFor(ref, compositions)?.variables.find((variable) => variable.type === 'text');
  if (!text || text.type !== 'text') return null;
  const value = ref.params[text.name];
  return typeof value === 'string' && value.trim() ? value : text.sample;
}

type Draft = Omit<EditItemPlace, 'number'>;

function sequencePlaces(
  timelineId: TimelineId,
  track: Extract<Track, { kind: 'video' | 'audio' }>,
  rate: FrameRate,
): Draft[] {
  const places: Draft[] = [];
  const itemKind: EditItemKind = track.kind === 'video' ? 'clip' : 'audio';
  let at = 0;
  for (const item of track.items as readonly SequenceItem[]) {
    if (item.type === 'transition') {
      const start = at - frames(item.inOffset, rate);
      const end = at + frames(item.outOffset, rate);
      const target = { kind: 'item', timelineId, itemId: item.id, itemKind: 'transition' } as const;
      places.push({ target, start, end, trackId: track.id, words: null });
      continue;
    }
    const length = frames(item.duration, rate);
    if (item.type === 'clip') {
      const target = { kind: 'item', timelineId, itemId: item.id, itemKind } as const;
      places.push({ target, start: at, end: at + length, trackId: track.id, words: null });
    }
    at += length;
  }
  return places;
}

/** Every item of the timeline, kind by kind (EDIT_ITEM_KINDS' order): clips in V1's order, the rest by time. */
export function editItemsOf(timeline: Timeline): EditItemPlace[] {
  const rate = timeline.canvas.rate;
  const drafts: Draft[] = [];
  for (const track of timeline.tracks) {
    if (track.kind === 'text') {
      for (const item of track.items) {
        const start = frames(item.start, rate);
        const target = {
          kind: 'item',
          timelineId: timeline.id,
          itemId: item.id,
          itemKind: item.type === 'text' ? 'text' : 'graphic',
        } as const;
        const words = item.type === 'text' ? item.text : graphicWords(item, timeline.graphicCompositions);
        drafts.push({ target, start, end: start + frames(item.duration, rate), trackId: track.id, words });
      }
    } else drafts.push(...sequencePlaces(timeline.id, track, rate));
  }
  for (const cue of timeline.captions?.cues ?? []) {
    const start = frames(cue.range.start, rate);
    const target = { kind: 'item', timelineId: timeline.id, itemId: cue.id, itemKind: 'caption' } as const;
    const words = cue.words.map((word) => word.text).join(' ');
    drafts.push({ target, start, end: start + frames(cue.range.duration, rate), trackId: null, words });
  }
  return EDIT_ITEM_KINDS.flatMap((kind) => {
    const ofKind = drafts.filter((draft) => draft.target.itemKind === kind);
    // Clips keep V1's order; the others go by time (a stable sort keeps the tracks' order on a tie).
    if (kind !== 'clip') ofKind.sort((a, b) => a.start - b.start);
    return ofKind.map((draft, index) => ({ ...draft, number: index + 1 }));
  });
}

/** The item with this id, or null when the timeline has none. */
export function findEditItem(timeline: Timeline, itemId: string): EditItemPlace | null {
  return editItemsOf(timeline).find((place) => place.target.itemId === itemId) ?? null;
}

/**
 * A target a model wrote (`editTargetJsonSchema`), made a real `EditTarget` on `timeline`: an item's kind is read
 * from the timeline (a model often leaves it out, names the wrong one, or writes it as `kind`), and a range is
 * checked as
 * `parseEditTarget` checks it. Null when it isn't a target, names another timeline, or names an item the timeline
 * doesn't have. Every tool that takes a target from a model resolves it with this before use.
 */
export function resolveEditTarget(value: unknown, timeline: Timeline): EditTarget | null {
  const written = editTargetJsonSchema.safeParse(value);
  if (!written.success || written.data.timelineId !== timeline.id) return null;
  const target = written.data;
  // An item, written as one or with its kind as `kind`: the timeline says what it is.
  if ('itemId' in target) return findEditItem(timeline, target.itemId)?.target ?? null;
  return parseEditTarget(target);
}
