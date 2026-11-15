// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: the gap check never counts a slot that keeps the reel's own footage. The owner's video was their clip and
 * two shots of a film; the gaps step stopped on "3 shots, 1 filled, 2 empty" and asked for footage for the film.
 * Now those two slots are clips cut from the template's reel (cast note `reelKept`): the stored timeline has no open
 * slot, so the step does not join and the run goes on to the Maker; and where a real gap stands beside them, the
 * card counts and asks about the person's shots only.
 */
import {
  DEFAULT_MIX,
  FrameRates,
  newId,
  RationalTime,
  type AssetId,
  type CastNote,
  type Id,
  type SequenceItem,
  type SlotCast,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { askReasons, gapTimelineOf, summaryOf } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { openSlots } from '../../src/gaps/proposals';

const fps = FrameRates.fps30;
const frames = (value: number) => RationalTime.of(value, fps);
const reel = newId<'Asset'>();
const slot = () => newId<'TemplateSlot'>();
const item = () => newId<'TimelineItem'>();

const clip = (
  id: TimelineItemId,
  slotId: Id<'TemplateSlot'>,
  assetId: AssetId,
  from: number,
  length: number,
): Extract<SequenceItem, { type: 'clip' }> => ({
  type: 'clip',
  id,
  media: { kind: 'video', assetId, shotId: null, available: { start: frames(0), duration: frames(467) } },
  sourceStart: frames(from),
  duration: frames(length),
  speed: null,
  slotId,
  syncPoint: null,
  beatAnchor: null,
  fit: 'contain',
  audio: { gainDb: 0, muted: true },
  locked: false,
  enabled: true,
  stillMotion: null,
  reframe: null,
});

const cast = (
  slotId: Id<'TemplateSlot'>,
  clipId: TimelineItemId | null,
  confidence: number | null,
  note: CastNote | null,
): SlotCast => ({ slotId, clipId, pick: null, alternates: [], confidence, needsRerank: false, note });

function timeline(items: SequenceItem[], slots: SlotCast[]): Timeline {
  return {
    schemaVersion: 2,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'v1',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: fps },
    template: null,
    beatMap: null,
    tracks: [{ kind: 'video', id: 'V1', name: 'V1', enabled: true, items }],
    markers: [],
    cast: {
      castId: newId<'Cast'>(),
      mode: 'template',
      variantIndex: 0,
      variantCount: 1,
      configVersion: 'test',
      sequenceConfidence: 0.9,
      slots,
    },
    captions: null,
    music: { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: 0 },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** Every pick is weak by this rule, so a reel slot that reached it would be listed. */
const everyPickWeak = () => ({
  pick: { assetId: 'a', shotId: null, description: null, fit: 0.1 },
  confidence: 0.1,
  candidates: [],
  better: null,
});

describe('the gap check and a slot that keeps the reel’s footage (KEEP1)', () => {
  it('the owner’s video has no open slot: their clip, and the film’s two shots are not the person’s to fill', () => {
    const [s1, s2, s3] = [slot(), slot(), slot()];
    const [mine, film, tail] = [item(), item(), item()];
    const stored = timeline(
      [
        clip(mine, s1, newId<'Asset'>(), 0, 324),
        clip(film, s2, reel, 324, 129),
        clip(tail, s3, reel, 453, 14),
      ],
      [cast(s1, mine, null, 'userPick'), cast(s2, film, null, 'reelKept'), cast(s3, tail, null, 'reelKept')],
    );
    const gaps = gapTimelineOf(stored, {
      minDuration: null,
      weakOf: (c) => (c.note === 'userPick' ? null : everyPickWeak()),
    });
    expect(gaps.slots.map((s) => [s.number, s.state])).toEqual([[1, 'picked']]);
    // No open slot: the gaps extension joins only when a timeline has one, so the run goes on to the Maker.
    expect(openSlots(gaps)).toEqual([]);
    expect(askReasons([gaps])).toEqual([]);
    expect(summaryOf(gaps)).toEqual({ shots: 1, filled: 1, empty: 0, unsure: 0 });
  });

  it('beside a real gap, the card asks about the person’s shot only and keeps the cast board’s numbers', () => {
    const [s1, s2, s3, s4] = [slot(), slot(), slot(), slot()];
    const [film, gap, mine, tail] = [item(), item(), item(), item()];
    const stored = timeline(
      [
        clip(film, s1, reel, 0, 90),
        { type: 'gap', id: gap, duration: frames(60), slotId: s2 },
        clip(mine, s3, newId<'Asset'>(), 0, 60),
        clip(tail, s4, reel, 210, 30),
      ],
      [
        cast(s1, film, null, 'reelKept'),
        cast(s2, null, null, 'noCandidates'),
        cast(s3, mine, 0.9, null),
        cast(s4, tail, null, 'reelKept'),
      ],
    );
    const gaps = gapTimelineOf(stored, { minDuration: null });
    expect(gaps.slots.map((s) => [s.number, s.state, s.gapId])).toEqual([
      [2, 'empty', gap],
      [3, 'picked', mine],
    ]);
    expect(gaps.slots[0]!.start).toEqual(frames(90));
    // "This video needs 2 clips. 1 of yours fits": the film's two shots are not counted.
    expect(summaryOf(gaps)).toEqual({ shots: 2, filled: 1, empty: 1, unsure: 0 });
    expect(askReasons([gaps])).toEqual(['empty']);
    // No reel clip is a clip another shot could borrow or reuse: none is listed at all.
    expect(gaps.slots.some((s) => s.current?.assetId === reel)).toBe(false);
  });

  it('a slot the person filled over the reel’s footage is theirs again', () => {
    const [s1, s2] = [slot(), slot()];
    const [mine, swapped] = [item(), item()];
    const stored = timeline(
      [clip(mine, s1, newId<'Asset'>(), 0, 90), clip(swapped, s2, newId<'Asset'>(), 0, 60)],
      [cast(s1, mine, 0.9, null), cast(s2, swapped, null, 'userPick')],
    );
    const gaps = gapTimelineOf(stored, { minDuration: null });
    expect(gaps.slots.map((s) => [s.number, s.state])).toEqual([
      [1, 'picked'],
      [2, 'picked'],
    ]);
  });
});
