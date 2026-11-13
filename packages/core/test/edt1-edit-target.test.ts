// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1: edit targets, the editor context, item chips (with the old clip chip) and every item's place. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { toJSONSchema } from 'zod';
import {
  chatContract,
  editItemsOf,
  editorContextSchema,
  editTargetJsonSchema,
  editTargetSchema,
  findEditItem,
  graphicCompositionSchema,
  graphicWords,
  MAX_EDITOR_SELECTION,
  newId,
  parseEditTarget,
  resolveEditTarget,
  sameEditTarget,
  selectionChipSchema,
  userMessageEventSchema,
  type EditTarget,
  type EditTargetJson,
  type Timeline,
} from '@taalcut/core';
import { at, json, ntscTimeline, span, T0 } from './helpers/documents';
import { COMPOSITION } from './helpers/hfw1';

const timelineId = newId<'Timeline'>();
const itemId = newId<'TimelineItem'>();
const item: EditTarget = { kind: 'item', timelineId, itemId, itemKind: 'text' };

describe('edit targets (EDT1)', () => {
  it('parses an item, a range and the whole timeline, and refuses unknown kinds', () => {
    expect(editTargetSchema.parse(json(item))).toEqual(item);
    const range = editTargetSchema.parse(json({ kind: 'range', timelineId, range: span(30, 60) }));
    expect(range).toMatchObject({ kind: 'range', range: { start: { value: 30 }, duration: { value: 60 } } });
    expect(editTargetSchema.parse({ kind: 'timeline', timelineId })).toEqual({
      kind: 'timeline',
      timelineId,
    });
    expect(editTargetSchema.safeParse({ ...item, itemKind: 'marker' }).success).toBe(false);
    expect(editTargetSchema.safeParse({ ...item, itemId: 'clip-3' }).success).toBe(false);
  });

  it('has a form a model writes, in JSON Schema, checked as a target before use', () => {
    // A range or the whole timeline as written is a target; an item may lack its kind, or write it as `kind`
    // (resolveEditTarget).
    expectTypeOf<Extract<EditTargetJson, { kind: 'range' | 'timeline' }>>().toExtend<EditTarget>();
    expectTypeOf(resolveEditTarget).returns.toEqualTypeOf<EditTarget | null>();
    const schema = JSON.stringify(toJSONSchema(editTargetJsonSchema));
    for (const kind of ['item', 'range', 'timeline']) expect(schema).toContain(`"${kind}"`);
    const range = {
      kind: 'range',
      timelineId,
      range: {
        start: { value: 30, rate: { num: 30, den: 1 } },
        duration: { value: 15, rate: { num: 30, den: 1 } },
      },
    };
    const written = editTargetJsonSchema.parse(range);
    expect(parseEditTarget(written)).toMatchObject({ kind: 'range', range: { duration: { value: 15 } } });
    expect(parseEditTarget(editTargetJsonSchema.parse(item))).toEqual(item);
    expect(parseEditTarget({ ...item, itemKind: 'sticker' })).toBeNull();
    // A negative length: the form takes it, the target doesn't.
    const backwards = {
      ...range,
      range: { ...range.range, duration: { value: -1, rate: { num: 30, den: 1 } } },
    };
    expect(editTargetJsonSchema.safeParse(backwards).success).toBe(true);
    expect(parseEditTarget(backwards)).toBeNull();
  });

  it('tells two targets apart', () => {
    const range = (start: number) =>
      editTargetSchema.parse(json({ kind: 'range', timelineId, range: span(start, 30) }));
    expect(sameEditTarget(item, { ...item, itemKind: 'text' })).toBe(true);
    expect(sameEditTarget(item, { ...item, itemId: newId<'TimelineItem'>() })).toBe(false);
    expect(sameEditTarget(range(0), range(0))).toBe(true);
    expect(sameEditTarget(range(0), range(1))).toBe(false);
    expect(sameEditTarget({ kind: 'timeline', timelineId }, { kind: 'timeline', timelineId })).toBe(true);
    expect(sameEditTarget(item, { kind: 'timeline', timelineId })).toBe(false);
  });

  it('holds the editor as the user saw it, its selection capped', () => {
    const context = {
      timelineId,
      revision: 4,
      playhead: at(45),
      selection: [item],
      visibleRange: span(0, 300),
    };
    expect(editorContextSchema.parse(json(context))).toMatchObject({ revision: 4, selection: [item] });
    expect(editorContextSchema.safeParse({ ...context, visibleRange: undefined }).success).toBe(true);
    expect(editorContextSchema.safeParse({ ...context, playhead: at(-1) }).success).toBe(false);
    expect(editorContextSchema.safeParse({ ...context, revision: 0 }).success).toBe(false);
    const many = Array.from({ length: MAX_EDITOR_SELECTION + 1 }, () => item);
    expect(editorContextSchema.safeParse({ ...context, selection: many }).success).toBe(false);
  });

  it('makes item chips, still reads the old clip chip, and carries the context on a message', () => {
    expect(selectionChipSchema.parse(item)).toEqual(item);
    const clip = { kind: 'clip', timelineId, clipId: itemId };
    expect(selectionChipSchema.parse(clip)).toEqual(clip);
    const editorContext = { timelineId, revision: 2, playhead: at(0), selection: [item] };
    const input = {
      conversationId: newId<'Conversation'>(),
      text: 'shorter',
      selections: [item],
      editorContext,
    };
    expect(chatContract.send['~orpc'].inputSchema?.safeParse(json(input)).success).toBe(true);
    const stored = userMessageEventSchema.parse(
      json({
        type: 'user.message',
        at: T0,
        payload: {
          messageId: newId<'Message'>(),
          conversationId: input.conversationId,
          text: 'x',
          editorContext,
        },
      }),
    );
    expect(stored.payload.editorContext?.selection).toEqual([item]);
  });
});

describe("a timeline's items as edit targets (EDT1)", () => {
  const timeline = ntscTimeline();

  it('places and numbers every kind of item', () => {
    const places = editItemsOf(timeline);
    const kinds = places.map((place) => `${place.target.itemKind} ${place.number}`);
    expect(kinds).toEqual([
      'clip 1',
      'clip 2',
      'text 1',
      'text 2',
      'caption 1',
      'caption 2',
      'audio 1',
      'transition 1',
    ]);
    const [first, second] = places;
    expect(first).toMatchObject({ start: 0, end: 60, trackId: 'V1', words: null });
    expect(second).toMatchObject({ start: 60, end: 120 });
    const transition = places.find((place) => place.target.itemKind === 'transition');
    expect(transition).toMatchObject({ start: 55, end: 65 });
    const caption = places.find((place) => place.target.itemKind === 'caption');
    expect(caption).toMatchObject({ trackId: null, words: 'hello', start: 0, end: 30 });
    expect(places.every((place) => place.target.timelineId === timeline.id)).toBe(true);
  });

  it('finds one item by id, and nothing for an id it lacks', () => {
    const video = timeline.tracks[0]!;
    const secondClip = video.items[2]!;
    expect(findEditItem(timeline, secondClip.id)).toMatchObject({ number: 2, target: { itemKind: 'clip' } });
    expect(findEditItem(timeline, newId<'TimelineItem'>())).toBeNull();
  });

  it('resolves a target a model wrote: the kind from the timeline, null for what it lacks', () => {
    const clip = timeline.tracks[0]!.items[2]!;
    const written = { kind: 'item', timelineId: timeline.id, itemId: clip.id };
    // The model's form takes an item by id alone; the strict target doesn't.
    expect(editTargetJsonSchema.safeParse(written).success).toBe(true);
    expect(parseEditTarget(written)).toBeNull();
    expect(editTargetSchema.safeParse(written).success).toBe(false);
    const resolved = resolveEditTarget(written, timeline);
    expect(resolved).toEqual({ ...written, itemKind: 'clip' });
    // A wrong kind is the timeline's again.
    expect(resolveEditTarget({ ...written, itemKind: 'graphic' }, timeline)).toEqual(resolved);
    // The kind written as `kind` is an item target too, its kind the timeline's.
    const asKind = { kind: 'clip', timelineId: timeline.id, itemId: clip.id };
    expect(editTargetJsonSchema.safeParse(asKind).success).toBe(true);
    expect(parseEditTarget(asKind)).toBeNull();
    expect(resolveEditTarget(asKind, timeline)).toEqual(resolved);
    expect(resolveEditTarget({ ...asKind, kind: 'graphic' }, timeline)).toEqual(resolved);
    expect(resolveEditTarget({ ...asKind, kind: 'marker' }, timeline)).toBeNull();
    expect(resolveEditTarget({ ...written, itemId: newId<'TimelineItem'>() }, timeline)).toBeNull();
    expect(resolveEditTarget({ ...written, timelineId: newId<'Timeline'>() }, timeline)).toBeNull();
    expect(resolveEditTarget({ kind: 'item', timelineId: timeline.id }, timeline)).toBeNull();
    expect(resolveEditTarget('clip 3', timeline)).toBeNull();
    // A range and the whole timeline are checked as parseEditTarget checks them.
    const rate = { num: 30_000, den: 1001 };
    const range = { start: { value: 30, rate }, duration: { value: 15, rate } };
    expect(resolveEditTarget({ kind: 'range', timelineId: timeline.id, range }, timeline)).toMatchObject({
      kind: 'range',
      range: { duration: { value: 15 } },
    });
    const backwards = { ...range, duration: { value: -1, rate } };
    expect(
      resolveEditTarget({ kind: 'range', timelineId: timeline.id, range: backwards }, timeline),
    ).toBeNull();
    expect(resolveEditTarget({ kind: 'timeline', timelineId: timeline.id }, timeline)).toEqual({
      kind: 'timeline',
      timelineId: timeline.id,
    });
  });

  it('names a graphic by its design’s first text variable', () => {
    const copy = graphicCompositionSchema.parse(COMPOSITION);
    const ref = { id: copy.id, hash: copy.hash, params: { message: 'Maya' } };
    expect(graphicWords({ composition: ref }, [copy])).toBe('Maya');
    expect(graphicWords({ composition: { ...ref, params: {} } }, [copy])).toBe('Are we there yet?');
    expect(graphicWords({ composition: ref })).toBeNull();
  });

  it('reads a timeline without captions or text', () => {
    const bare: Timeline = { ...timeline, captions: null, tracks: [timeline.tracks[0]!] };
    expect(editItemsOf(bare).map((place) => place.target.itemKind)).toEqual(['clip', 'clip', 'transition']);
  });
});
