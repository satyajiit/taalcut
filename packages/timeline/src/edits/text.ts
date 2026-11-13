// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** timeline.editText, timeline.moveText and timeline.lockClip: changes that move no cut. */
import {
  err,
  ok,
  RationalTime,
  type NormalisedBox,
  type Result,
  type TextTrackItem,
  type Timeline,
  type TimelineItemId,
  type Track,
} from '@taalcut/core';
import { InvalidMove, ItemNotFound } from '../errors';
import { findPosition, videoItems, withVideoItems } from '../model/sequence';
import { unchanged, type EditOptions, type EditResult } from './types';

export interface TextEditEntry {
  readonly itemId: TimelineItemId;
  readonly text?: string | undefined;
  readonly start?: RationalTime | undefined;
  readonly duration?: RationalTime | undefined;
  readonly box?: NormalisedBox | undefined;
  readonly remove?: boolean | undefined;
}

export interface EditTextInput extends Partial<TextEditEntry> {
  readonly edits?: readonly TextEditEntry[] | undefined;
}

export interface TextMoveEntry {
  readonly itemId: TimelineItemId;
  readonly box: NormalisedBox;
}

export interface MoveTextInput {
  readonly itemId?: TimelineItemId | undefined;
  readonly itemIds?: readonly TimelineItemId[] | undefined;
  readonly box?: NormalisedBox | undefined;
  readonly moves?: readonly TextMoveEntry[] | undefined;
}

type TextTrack = Extract<Track, { kind: 'text' }>;
const isTextTrack = (track: Track): track is TextTrack => track.kind === 'text';

function videoDurationFrames(timeline: Timeline): number {
  let frames = 0;
  for (const item of videoItems(timeline)) {
    if (item.type !== 'transition') frames += item.duration.value;
  }
  return Math.max(1, frames);
}

function overlaps(a: TextTrackItem, b: TextTrackItem): boolean {
  const aStart = a.start.value;
  const aEnd = aStart + a.duration.value;
  const bStart = b.start.value;
  const bEnd = bStart + b.duration.value;
  return aStart < bEnd && bStart < aEnd;
}

function placeTextItems(tracks: readonly Track[], retimed: readonly TextTrackItem[]): Result<Track[]> {
  let nextTracks = [...tracks];
  const sorted = (items: readonly TextTrackItem[]) =>
    [...items].sort((a, b) => RationalTime.compare(a.start, b.start));
  for (const item of retimed) {
    const target = nextTracks.find(
      (track): track is TextTrack =>
        isTextTrack(track) && track.enabled && track.items.every((other) => !overlaps(item, other)),
    );
    if (target) {
      nextTracks = nextTracks.map((track) =>
        track === target && isTextTrack(track) ? { ...track, items: sorted([...track.items, item]) } : track,
      );
      continue;
    }
    const used = new Set(nextTracks.filter(isTextTrack).map((track) => track.id));
    const id = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `T${n}`).find((candidate) => !used.has(candidate));
    if (!id || nextTracks.length >= 16)
      return err(InvalidMove({}, { detail: 'No text track is free at the requested time' }));
    nextTracks = [...nextTracks, { kind: 'text', id, name: 'Text', enabled: true, items: [item] }];
  }
  return ok(nextTracks);
}

export function editText(timeline: Timeline, input: EditTextInput, options: EditOptions): Result<EditResult> {
  const entries: TextEditEntry[] = [
    ...(input.itemId !== undefined
      ? [
          {
            itemId: input.itemId,
            text: input.text,
            start: input.start,
            duration: input.duration,
            box: input.box,
            remove: input.remove,
          },
        ]
      : []),
    ...(input.edits ?? []),
  ];
  const byId = new Map<string, TextEditEntry>();
  for (const entry of entries) byId.set(entry.itemId, { ...byId.get(entry.itemId), ...entry });
  if (byId.size === 0) return unchanged(timeline);

  const origin = options.source === 'agent' ? 'editor' : 'user';
  const rate = timeline.canvas.rate;
  const maxFrames = videoDurationFrames(timeline);
  const seen = new Set<string>();
  const retimed: TextTrackItem[] = [];

  const baseTracks = timeline.tracks.map((track) => {
    if (!isTextTrack(track)) return track;
    const kept: TextTrackItem[] = [];
    for (const item of track.items) {
      const edit = byId.get(item.id);
      if (!edit) {
        kept.push(item);
        continue;
      }
      if (edit.remove) {
        seen.add(item.id);
        continue;
      }
      // HFW1: a graphic's words are its design's variables (graphics.edit's params), not a text item's.
      if (item.type !== 'text') {
        kept.push(item);
        continue;
      }
      seen.add(item.id);
      let updated: TextTrackItem = item;
      if (edit.text !== undefined) {
        updated = { ...updated, text: edit.text, origin };
      }
      if (edit.box !== undefined) {
        const { placement: _solved, ...rest } = updated;
        updated = { ...rest, box: { ...edit.box } };
      }
      if (edit.start !== undefined || edit.duration !== undefined) {
        const rawStart =
          edit.start !== undefined
            ? RationalTime.rescale(edit.start, rate, 'round').value
            : updated.start.value;
        const startFrames = Math.max(0, Math.min(rawStart, maxFrames - 1));
        const rawDur =
          edit.duration !== undefined
            ? RationalTime.rescale(edit.duration, rate, 'round').value
            : updated.duration.value;
        const durFrames = Math.max(1, Math.min(rawDur, maxFrames - startFrames));
        updated = {
          ...updated,
          start: RationalTime.of(startFrames, rate),
          duration: RationalTime.of(durFrames, rate),
        };
        retimed.push(updated);
      } else {
        kept.push(updated);
      }
    }
    return { ...track, items: kept };
  });

  for (const id of byId.keys()) {
    if (!seen.has(id)) {
      return err(ItemNotFound({ itemId: id as TimelineItemId }, { detail: textItemsLine(timeline, id) }));
    }
  }
  const tracks = retimed.length > 0 ? placeTextItems(baseTracks, retimed) : ok(baseTracks);
  if (!tracks.ok) return tracks;
  return ok({ timeline: { ...timeline, tracks: tracks.value }, changed: ['tracks'] });
}

export function moveText(
  timeline: Timeline,
  input: MoveTextInput,
  _options: EditOptions,
): Result<EditResult> {
  const moves: TextMoveEntry[] = [
    ...(input.itemId !== undefined && input.box !== undefined
      ? [{ itemId: input.itemId, box: input.box }]
      : []),
    ...(input.itemIds && input.box !== undefined
      ? input.itemIds.map((itemId) => ({ itemId, box: input.box! }))
      : []),
    ...(input.moves ?? []),
  ];
  const byId = new Map<string, NormalisedBox>();
  for (const move of moves) byId.set(move.itemId, move.box);
  if (byId.size === 0) return unchanged(timeline);

  const seen = new Set<string>();
  const tracks = timeline.tracks.map((track) => {
    if (track.kind !== 'text') return track;
    return {
      ...track,
      items: track.items.map((item): TextTrackItem => {
        const box = byId.get(item.id);
        // Text items only: a motion graphic (Timeline v2) moves by its placement (graphics.edit).
        if (!box || item.type !== 'text') return item;
        seen.add(item.id);
        // FRM1-OVL: the person placed it now, so the solver's record goes and no later solve moves it.
        const { placement: _solved, ...rest } = item;
        return { ...rest, box: { ...box } };
      }),
    };
  });
  for (const id of byId.keys()) {
    if (!seen.has(id)) {
      return err(ItemNotFound({ itemId: id as TimelineItemId }, { detail: textItemsLine(timeline, id) }));
    }
  }
  return ok({ timeline: { ...timeline, tracks }, changed: ['tracks'] });
}

/**
 * AGT1: what a refused text edit names instead: the timeline's text items by id, kind and start. MLX1's 9B guessed
 * seven ids in a row from the timeline's own; ids and times only, never the words (they may be the reel's).
 */
function textItemsLine(timeline: Timeline, itemId: string): string {
  const items = timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item) => item.type === 'text') : [],
  );
  if (items.length === 0) return `No text item ${itemId}: this timeline has no text items.`;
  const listed = items
    .slice(0, 12)
    .map((item) => `${item.id} (${item.type} at ${RationalTime.toSeconds(item.start).toFixed(1)} s)`);
  return `No text item ${itemId} in this timeline. Its text items: ${listed.join(', ')}${items.length > 12 ? ', …' : ''}. Use one of these ids, or timeline.get to read them.`;
}

/** Lock state changes only through this explicit command; ordinary edits still reject locked clips. */
export function lockClip(
  timeline: Timeline,
  input: { readonly clipId: TimelineItemId; readonly locked: boolean },
  _options: EditOptions,
): Result<EditResult> {
  const position = findPosition(timeline, input.clipId);
  if (!position || position.item.type !== 'clip') return err(ItemNotFound({ itemId: input.clipId }));
  if (position.item.locked === input.locked) return unchanged(timeline);
  const items = [...videoItems(timeline)];
  items[position.itemIndex] = { ...position.item, locked: input.locked };
  return ok({ timeline: withVideoItems(timeline, items), changed: ['tracks'] });
}
