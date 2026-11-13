// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-2: persisted media time is RationalTime everywhere (SPEC section 3): a voice line's length, a title
 * card bumper, a graphics command and the motion graphic card, a reference pointer's range. What round P3-1
 * stored in milliseconds or float seconds still parses, as the same instant.
 */
import { describe, expect, it } from 'vitest';
import {
  BUMPER_CARD_LIMITS,
  FrameRates,
  fromMilliseconds,
  GRAPHIC_DURATION_LIMITS,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  newId,
  parseCard,
  RationalTime,
  referencePointerSchema,
  styleBumperSchema,
  TimeRange,
  voiceLineSchema,
} from '@taalcut/core';
import { at, issuePaths, span } from './helpers/documents';
import { PHASE3_CARDS } from './helpers/phase3-cards';

const ms = (value: number) => RationalTime.of(value, FrameRates.milliseconds);
const line = {
  id: newId<'VoiceLine'>(),
  text: 'Day one in Goa.',
  slotId: null,
  clipId: null,
  assetId: null,
  quality: 'draft',
  offBeat: false,
} as const;

describe('milliseconds as media time', () => {
  it('are exactly a time at 1000/1, equal to the frame they land on', () => {
    expect(fromMilliseconds(1_500)).toEqual(ms(1_500));
    expect(RationalTime.equals(fromMilliseconds(2_000), at(60))).toBe(true);
    expect(RationalTime.equals(fromMilliseconds(1_001), RationalTime.of(30, FrameRates.fps29_97))).toBe(true);
  });
});

describe('a voice line', () => {
  it("keeps its length on the clip's clock", () => {
    expect(voiceLineSchema.parse({ ...line, duration: at(54) }).duration).toEqual(at(54));
    expect(issuePaths(voiceLineSchema, { ...line, duration: at(-1) })).toEqual(['duration']);
    expect(issuePaths(voiceLineSchema, line)).toEqual(['duration']);
    expect(issuePaths(voiceLineSchema, { ...line, text: '', duration: at(1) })).toEqual(['text']);
  });

  it('stored in round P3-1 milliseconds reads as the same length', () => {
    const parsed = voiceLineSchema.parse({ ...line, durationMs: 1_800 });
    expect(parsed).toEqual({ ...line, duration: ms(1_800) });
    expect('durationMs' in parsed).toBe(false);
    expect(voiceLineSchema.parse({ ...line, duration: at(54), durationMs: 9 }).duration).toEqual(at(54));
  });

  it('on a stored voiceover card reads the same way', () => {
    const card = PHASE3_CARDS.voiceover;
    const [first] = card.voiceover.lines;
    const { duration: _duration, ...rest } = first ?? { ...line, duration: at(1) };
    const old = { ...card, voiceover: { ...card.voiceover, lines: [{ ...rest, durationMs: 1_400 }] } };
    const parsed = parseCard(old);
    expect(
      parsed.ok && parsed.value.type === 'voiceover' && parsed.value.voiceover.lines[0]?.duration,
    ).toEqual(ms(1_400));
  });
});

describe('a title card bumper', () => {
  const card = { kind: 'card', text: 'Goa', background: 'primary' } as const;

  it('lasts 1 to 4 seconds at any rate', () => {
    expect(styleBumperSchema.parse({ ...card, duration: at(60) })).toEqual({ ...card, duration: at(60) });
    expect(styleBumperSchema.safeParse({ ...card, duration: BUMPER_CARD_LIMITS.max }).success).toBe(true);
    expect(issuePaths(styleBumperSchema, { ...card, duration: at(29) })).toEqual(['duration']);
    expect(
      issuePaths(styleBumperSchema, { ...card, duration: RationalTime.of(4_001, FrameRates.milliseconds) }),
    ).toEqual(['duration']);
    expect(issuePaths(styleBumperSchema, card)).toEqual(['duration']);
  });

  it('stored in round P3-1 float seconds reads in whole milliseconds', () => {
    expect(styleBumperSchema.parse({ ...card, seconds: 1.5 })).toEqual({ ...card, duration: ms(1_500) });
    expect(styleBumperSchema.safeParse({ ...card, seconds: 5 }).success).toBe(false);
  });
});

describe('graphics commands', () => {
  const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
  const itemId = newId<'TimelineItem'>();
  const edit = graphicsCommandPayloads[GRAPHICS_COMMANDS.edit];

  it('take a length as media time, 0.5 to 15 s exactly', () => {
    expect(edit.parse({ ...target, itemId, duration: at(45) }).duration).toEqual(at(45));
    expect(edit.safeParse({ ...target, itemId, duration: GRAPHIC_DURATION_LIMITS.min }).success).toBe(true);
    expect(
      edit.safeParse({ ...target, itemId, duration: RationalTime.of(11, FrameRates.fps23_976) }).success,
    ).toBe(false);
    expect(edit.parse({ ...target, itemId }).duration).toBeUndefined();
  });

  it('from a round P3-1 audit-log entry still redo, as the same length', () => {
    const old = edit.parse({ ...target, itemId: newId<'TimelineItem'>(), durationMs: 2_000 });
    expect(old.duration).toEqual(ms(2_000));
    expect('durationMs' in old).toBe(false);
    expect(edit.safeParse({ ...target, itemId: newId<'TimelineItem'>(), durationMs: 100 }).success).toBe(
      false,
    );
  });
});

describe('the motion graphic card', () => {
  it('sits on the timeline in media time', () => {
    const parsed = parseCard(PHASE3_CARDS.motionGraphic);
    expect(parsed.ok && parsed.value.type === 'motionGraphic' && parsed.value.start).toEqual(at(120));
  });

  it('stored by round P3-1 in milliseconds reads as the same place', () => {
    const { start: _start, duration: _duration, ...card } = PHASE3_CARDS.motionGraphic;
    const parsed = parseCard({ ...card, startMs: 4_000, durationMs: 2_000 });
    expect(
      parsed.ok && parsed.value.type === 'motionGraphic' && [parsed.value.start, parsed.value.duration],
    ).toEqual([ms(4_000), ms(2_000)]);
    expect(parseCard({ ...card, startMs: 4_000, durationMs: 0 }).ok).toBe(false);
  });
});

describe('a reference pointer', () => {
  const pointer = {
    said: 'at 0:04',
    basis: 'timeline',
    kind: 'range',
    templateId: null,
    timelineId: newId<'Timeline'>(),
    slotId: null,
    slotNumber: null,
    clipId: null,
  } as const;

  it("points at a span in the basis's time", () => {
    expect(referencePointerSchema.parse({ ...pointer, range: span(120, 15) }).range).toEqual(span(120, 15));
  });

  it('stored by round P3-1 in milliseconds reads as the same span', () => {
    expect(
      referencePointerSchema.parse({ ...pointer, range: { startMs: 4_000, endMs: 4_500 } }).range,
    ).toEqual(TimeRange.of(ms(4_000), ms(500)));
    expect(
      referencePointerSchema.safeParse({ ...pointer, range: { startMs: 5_000, endMs: 4_000 } }).success,
    ).toBe(false);
  });
});
