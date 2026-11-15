// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1 contract: a made video's text is designed and placed by whoever makes it; no schema here moves, clamps or
 * refuses a place or a size. Every addition is optional, so the Styles, templates and timelines stored before it
 * open unchanged; the hub's v0 text look is as it was.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTION_FONTS,
  designTextPayloadSchema,
  hubTextLookSchema,
  newId,
  overlayDesignSchema,
  overlayTypeSchema,
  placeTextPayloadSchema,
  READABLE_CAP_PX,
  readableTextSize,
  TEXT_BREAKS,
  TEXT_DESIGN_COMMAND,
  TEXT_PLACE_COMMAND,
  textItemSchema,
  textLookSchema,
  textRolesOf,
  undesignedTextRoles,
  unplacedTexts,
  type TextItem,
  type TextLook,
} from '../src';

const rate = { num: 30, den: 1 };
const at = (value: number) => ({ value, rate });
const item = (overrides: Partial<TextItem> = {}): TextItem =>
  textItemSchema.parse({
    type: 'text',
    id: newId<'TimelineItem'>(),
    start: at(0),
    duration: at(30),
    text: 'I hope',
    role: 'label',
    slotId: null,
    overlayId: null,
    box: { x: 0.3, y: 0.5, width: 0.4, height: 0.05 },
    appearance: { size: 0.03, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'label',
    reveal: 'none',
    language: 'en',
    origin: 'template',
    ...overrides,
  });
const before: Omit<TextLook, 'shadow' | 'letterSpacing'> = {
  font: { family: 'notoSans', weight: 700 },
  colour: '#ffffff',
  background: null,
  stroke: { colour: '#000000', widthPx: 4 },
};

describe('TXT1: the reading fact', () => {
  it('is one number: a 36 px capital at 1080 on the shorter side, as a share of the frame’s height', () => {
    expect(READABLE_CAP_PX).toBe(36);
    expect(readableTextSize({ width: 1080, height: 1920 })).toBeCloseTo(36 / 1920, 12);
    expect(readableTextSize({ width: 1920, height: 1080 })).toBeCloseTo(36 / 1080, 12);
    expect(readableTextSize({ width: 2160, height: 3840 })).toBeCloseTo(72 / 3840, 12);
  });
});

describe('TXT1: a text look, and what stored documents had', () => {
  it('a look stored before TXT1 parses as it was; a shadow and letter spacing are new and optional', () => {
    expect(textLookSchema.parse(before)).toEqual(before);
    const now = {
      ...before,
      shadow: { colour: '#000000', opacity: 0.6, blurPx: 12, offsetPx: 3 },
      letterSpacing: 0.04,
    };
    expect(textLookSchema.parse(now)).toEqual(now);
    expect(textLookSchema.parse({ ...before, shadow: null }).shadow).toBeNull();
    expect(textLookSchema.safeParse({ ...before, letterSpacing: 0.8 }).success).toBe(false);
  });

  it('the hub’s v0 text look is as it was: it takes no shadow and no letter spacing', () => {
    expect(hubTextLookSchema.safeParse(before).success).toBe(true);
    expect(hubTextLookSchema.safeParse({ ...before, letterSpacing: 0.04 }).success).toBe(false);
    expect(hubTextLookSchema.safeParse({ ...before, shadow: null }).success).toBe(false);
  });

  it('six faces join the curated set: two serifs, a condensed sans, two scripts, a typewriter face', () => {
    expect(CAPTION_FONTS.slice(-6)).toEqual([
      'playfairDisplay',
      'cormorantGaramond',
      'oswald',
      'caveat',
      'dancingScript',
      'courierPrime',
    ]);
    expect(CAPTION_FONTS).toHaveLength(15);
  });

  it('a text item says who placed it; one nobody placed, and every item from before, says nothing', () => {
    expect(item().placedBy).toBeUndefined();
    expect(item({ placedBy: 'person' }).placedBy).toBe('person');
    expect(textItemSchema.safeParse({ ...item(), placedBy: 'solver' }).success).toBe(false);
  });

  it('an overlay design may carry how its letters are set; one from before TXT1 has none', () => {
    const design = {
      kind: 'plain',
      colors: { fill: null, text: '#ffffff', stroke: '#000000' },
      cornerRadius: 0,
      font: { class: 'sans', weight: 800 },
      motion: { enter: 'pop', exit: 'none', typing: false },
      confidence: 0.8,
    };
    expect(overlayDesignSchema.parse(design).type).toBeUndefined();
    const type = {
      stem: 0.2,
      outline: 0.09,
      shadow: false,
      width: 'condensed',
      spacing: null,
      confidence: 0.7,
    };
    expect(overlayDesignSchema.parse({ ...design, type }).type).toEqual(type);
    expect(overlayTypeSchema.safeParse({ ...type, width: 'narrow' }).success).toBe(false);
  });
});

describe('TXT1: timeline.designText', () => {
  it('takes a look for each role, with the role’s case and arrival', () => {
    expect(TEXT_DESIGN_COMMAND).toBe('timeline.designText');
    const payload = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      styleId: newId<'Style'>(),
      name: 'Heavy white',
      looks: [{ role: 'label', look: { ...before, shadow: null }, case: 'upper', reveal: 'pop' }],
    };
    expect(designTextPayloadSchema.parse(payload)).toEqual(payload);
    expect(designTextPayloadSchema.safeParse({ ...payload, looks: [] }).success).toBe(false);
    expect(designTextPayloadSchema.safeParse({ ...payload, name: ' ' }).success).toBe(false);
  });

  it('names the roles a video’s text uses, and those a Style leaves in the default face', () => {
    const texts = [
      item(),
      item({ start: at(30) }),
      item({ start: at(60), styleKey: 'title', role: 'title' }),
    ];
    const timeline = {
      tracks: [
        { kind: 'video' as const, id: 'V1', name: 'Video', enabled: true, items: [] },
        { kind: 'text' as const, id: 'T1', name: 'Text', enabled: true, items: texts },
        { kind: 'text' as const, id: 'T2', name: 'Off', enabled: false, items: [item({ styleKey: 'cta' })] },
      ],
    };
    expect(textRolesOf(timeline).map((use) => [use.role, use.itemIds.length])).toEqual([
      ['label', 2],
      ['title', 1],
    ]);
    expect(undesignedTextRoles(timeline, null).map((use) => use.role)).toEqual(['label', 'title']);
    const look = textLookSchema.parse(before);
    expect(undesignedTextRoles(timeline, { textStyles: { label: look } }).map((use) => use.role)).toEqual([
      'title',
    ]);
    expect(undesignedTextRoles(timeline, { textStyles: { label: look, title: look } })).toEqual([]);
  });
});

describe('TXT1: timeline.placeText', () => {
  const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
  const itemId = newId<'TimelineItem'>();

  it('takes a place, an alignment and a size for each group, or "as the reel has it"', () => {
    expect(TEXT_PLACE_COMMAND).toBe('timeline.placeText');
    const groups = [
      { itemId, x: 0.5, y: 0.86, align: 'center' as const, size: 0.0073 },
      { itemId: newId<'TimelineItem'>(), asReel: true },
      { itemId: newId<'TimelineItem'>(), size: 0.04 },
    ];
    expect(placeTextPayloadSchema.parse({ ...target, groups }).groups).toEqual(groups);
    expect(placeTextPayloadSchema.safeParse({ ...target, groups: [] }).success).toBe(false);
  });

  it('holds a place to the frame’s own shares and nothing narrower: no safe area, no smallest size', () => {
    const at = (place: object) =>
      placeTextPayloadSchema.safeParse({ ...target, groups: [{ itemId, ...place }] });
    expect(at({ x: 0, y: 1 }).success).toBe(true);
    expect(at({ x: 1, y: 0, size: 0.005 }).success).toBe(true);
    expect(at({ y: 1.2 }).success).toBe(false);
  });

  it('states the lines: a width to wrap at is the only one a place carries; a text says how its words break', () => {
    const at = (place: object) =>
      placeTextPayloadSchema.safeParse({ ...target, groups: [{ itemId, ...place }] });
    expect(at({ x: 0.5, y: 0.6, size: 0.04, width: 0.6 }).success).toBe(true);
    expect(at({ width: 1 }).success).toBe(true);
    expect(at({ width: 0.01 }).success).toBe(false);
    expect(at({ width: 1.2 }).success).toBe(false);
    expect(TEXT_BREAKS).toEqual(['written', 'width']);
    // A text from before has no `breaks` and parses as it was.
    expect(item().breaks).toBeUndefined();
    expect('breaks' in item()).toBe(false);
    expect(item({ breaks: 'written' }).breaks).toBe('written');
    expect(textItemSchema.safeParse({ ...item(), breaks: 'frame' }).success).toBe(false);
  });

  it('names the texts made from the reference that nobody has placed yet', () => {
    const overlayId = newId<'TextOverlay'>();
    const texts = [
      item({ overlayId }),
      item({ overlayId, start: at(30), placedBy: 'editor' }),
      item({ overlayId, start: at(60), placedBy: 'person' }),
      // Added by hand or by a tool: placed when it was made.
      item({ start: at(90) }),
    ];
    const timeline = {
      tracks: [
        { kind: 'video' as const, id: 'V1', name: 'Video', enabled: true, items: [] },
        { kind: 'text' as const, id: 'T1', name: 'Text', enabled: true, items: texts },
      ],
    };
    expect(unplacedTexts(timeline)).toEqual([texts[0]!.id]);
    expect(unplacedTexts({ tracks: [] })).toEqual([]);
  });
});
