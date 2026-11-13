// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-CTX: the changes card's rows, from a snapshot of the timeline before and after a turn. */
import { describe, expect, it } from 'vitest';
import {
  diffEdits,
  digest,
  editChangesCardSchema,
  editSnapshot,
  MAX_EDIT_CHANGES,
  newId,
  type GraphicItem,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { at, ntscTimeline } from './helpers/documents';
import { EDIT_CHANGES_CARD } from './helpers/edt1-cards';
import { COMPOSITION } from './helpers/hfw1';

type Video = Extract<Track, { kind: 'video' }>;
type Text = Extract<Track, { kind: 'text' }>;

const graphic = (start: number): GraphicItem => ({
  type: 'graphic',
  id: newId<'TimelineItem'>(),
  anchor: { kind: 'time', at: at(start, { num: 30000, den: 1001 }) },
  start: at(start, { num: 30000, den: 1001 }),
  duration: at(60, { num: 30000, den: 1001 }),
  placement: 'bottom',
  styleKey: 'title',
  language: 'en',
  origin: 'agent',
  composition: { id: COMPOSITION.id, hash: COMPOSITION.hash, params: { message: 'Maya' } },
});

/** The fixture with a graphic on T1, as the turn found it. */
function base(): Timeline {
  const timeline = ntscTimeline();
  const text = timeline.tracks[2] as Text;
  return {
    ...timeline,
    tracks: [timeline.tracks[0]!, timeline.tracks[1]!, { ...text, items: [...text.items, graphic(70)] }],
  };
}

const edit = (timeline: Timeline, change: (copy: Timeline) => void): Timeline => {
  const copy = structuredClone(timeline);
  change(copy);
  return { ...copy, revision: timeline.revision + 1 };
};
const video = (timeline: Timeline) => timeline.tracks[0] as Video;
const texts = (timeline: Timeline) => timeline.tracks[2] as Text;
const diff = (before: Timeline, after: Timeline) => diffEdits(editSnapshot(before), editSnapshot(after));

describe('the changes card from a turn (EDT1-CTX)', () => {
  it('finds nothing when nothing changed, whatever the revision', () => {
    const timeline = base();
    expect(diff(timeline, { ...timeline, revision: 9 })).toEqual({ changes: [], more: 0 });
  });

  it("says a clip's new length in seconds, at its place", () => {
    const before = base();
    const after = edit(before, (copy) => {
      const first = video(copy).items[0]!;
      if (first.type === 'clip') first.duration = at(45, first.duration.rate);
    });
    const { changes } = diff(before, after);
    expect(changes).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ itemKind: 'clip' }),
        number: 1,
        at: 0,
        change: { kind: 'length', before: 2.002, after: 1.502 },
      }),
    ]);
  });

  it("words a text's new words and its role, and a graphic moved to the top", () => {
    const before = base();
    const after = edit(before, (copy) => {
      const [first, , moved] = texts(copy).items;
      if (first?.type === 'text') first.text = 'Day one';
      if (moved?.type === 'graphic') moved.placement = 'top';
    });
    const kinds = diff(before, after).changes.map((row) => [
      row.target.kind === 'item' && row.target.itemKind,
      row.change,
    ]);
    expect(kinds).toEqual([
      ['text', { kind: 'words', before: 'Day 1', after: 'Day one' }],
      ['graphic', { kind: 'place', before: 'bottom', after: 'top' }],
    ]);
    expect(diff(before, after).changes[0]).toMatchObject({ role: 'title', number: 1 });
  });

  it('reports a swap, a new speed, a framing, a transition and a volume', () => {
    const before = base();
    const after = edit(before, (copy) => {
      const [first, transition, second] = video(copy).items;
      if (first?.type === 'clip') {
        first.media = { ...first.media, assetId: newId<'Asset'>() } as typeof first.media;
        first.fit = 'contain';
      }
      if (transition?.type === 'transition') transition.kind = 'whip';
      if (second?.type === 'clip') {
        second.speed = {
          points: [
            { at: at(0), speed: 0.5 },
            { at: at(30), speed: 0.5 },
          ],
          curve: 'linear',
        };
        second.audio = { gainDb: 0, muted: true };
      }
    });
    expect(diff(before, after).changes.map((row) => row.change)).toEqual([
      { kind: 'media' },
      { kind: 'framing', before: 'cover', after: 'contain' },
      { kind: 'transition', before: 'dissolve', after: 'whip' },
      { kind: 'speed', before: 1, after: 0.5 },
      { kind: 'volume', before: 0, after: null },
    ]);
  });

  it('adds and removes, and moves one clip without moving the rest', () => {
    const before = edit(base(), (copy) => {
      const items = video(copy).items;
      items.push({ ...structuredClone(items[0]!), id: newId<'TimelineItem'>() });
    });
    const after = edit(before, (copy) => {
      const items = video(copy).items;
      // The last clip goes first; the gap is removed; a text is added.
      const last = items.pop()!;
      items.unshift(last);
      video(copy).items = items.filter((item) => item.type !== 'gap');
      texts(copy).items.push({
        ...structuredClone(texts(copy).items[0]!),
        id: newId<'TimelineItem'>(),
        start: at(200),
      } as never);
    });
    const changes = diff(before, after).changes;
    const orders = changes.filter((row) => row.change.kind === 'order');
    expect(orders).toEqual([
      expect.objectContaining({ number: 1, change: { kind: 'order', before: 3, after: 1 } }),
    ]);
    expect(changes.some((row) => row.change.kind === 'added')).toBe(true);
    // A gap isn't something a person points at: its going is no row of its own.
    expect(changes.some((row) => row.change.kind === 'removed')).toBe(false);
  });

  it('lists a removed item at its old place, and a whole-video change last', () => {
    const before = base();
    const after = edit(before, (copy) => {
      texts(copy).items.splice(1, 1);
      copy.music = { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: -3 };
    });
    const changes = diff(before, after).changes;
    expect(changes.at(-1)).toEqual({
      target: { kind: 'timeline', timelineId: before.id },
      number: null,
      at: null,
      change: { kind: 'setting', what: 'music' },
    });
    expect(changes.find((row) => row.change.kind === 'removed')).toMatchObject({ number: 2, at: 1.001 });
  });

  it('says only that something changed when nothing it words did', () => {
    const before = base();
    const after = edit(before, (copy) => {
      const first = texts(copy).items[0]!;
      if (first.type === 'text') first.reveal = 'pop';
    });
    expect(diff(before, after).changes.map((row) => row.change)).toEqual([{ kind: 'other' }]);
  });

  it('keeps the card to its limit and counts the rest, and every row fits the card', () => {
    const before = base();
    const after = edit(before, (copy) => {
      for (let n = 0; n < MAX_EDIT_CHANGES + 5; n += 1)
        texts(copy).items.push({
          ...structuredClone(texts(copy).items[0]!),
          id: newId<'TimelineItem'>(),
          start: at(300 + n * 30),
        } as never);
    });
    const { changes, more } = diff(before, after);
    expect(changes).toHaveLength(MAX_EDIT_CHANGES);
    expect(more).toBe(5);
    expect(editChangesCardSchema.safeParse({ ...EDIT_CHANGES_CARD, changes, more }).success).toBe(true);
  });

  it('digests equal values alike and different ones apart', () => {
    expect(digest({ a: 1 })).toBe(digest({ a: 1 }));
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
    expect(digest(undefined)).toBe(digest(undefined));
  });
});
