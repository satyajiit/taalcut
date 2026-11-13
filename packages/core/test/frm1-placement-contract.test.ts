// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL's contract §2: an overlay design's placement relation (beside the subject's head, or a band of the
 * frame), a made text or graphic item's placement record (the solver's reason), and render QA's
 * `graphicCoversFace`. Additive: designs and text items from before FRM1 parse unchanged. HFW1 retire: the kit's
 * wrap width went with the kit; a graphic is a composition's.
 */
import { describe, expect, it } from 'vitest';
import {
  graphicItemSchema,
  madePlacementSchema,
  newId,
  OVERLAY_PLACEMENT_SIDES,
  OVERLAY_PLACEMENT_ZONES,
  overlayDesignSchema,
  overlayPlacementSchema,
  PLACEMENT_REASONS,
  QA_CHECK_IDS,
  RationalTime,
  textItemSchema,
} from '../src';
import { COMPOSITION } from './helpers/hfw1';

const rate = { num: 30, den: 1 };

const design = {
  kind: 'chatBubble',
  colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
  cornerRadius: 0.32,
  tail: 'right',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'none', exit: 'none', typing: false },
  shape: { x: 0.25, y: 0.21, width: 0.27, height: 0.06 },
  confidence: 0.86,
} as const;

const graphic = {
  type: 'graphic',
  id: newId<'TimelineItem'>(),
  anchor: { kind: 'time', at: RationalTime.of(100, rate) },
  start: RationalTime.of(100, rate),
  duration: RationalTime.of(36, rate),
  placement: { box: { x: 0.3, y: 0.33, width: 0.2, height: 0.07 } },
  styleKey: 'label',
  language: 'en',
  origin: 'agent',
  composition: { id: COMPOSITION.id, hash: COMPOSITION.hash, params: { message: 'Made-up words' } },
} as const;

const text = {
  type: 'text',
  id: newId<'TimelineItem'>(),
  start: RationalTime.of(0, rate),
  duration: RationalTime.of(45, rate),
  text: 'Made-up words',
  role: 'label',
  slotId: null,
  overlayId: null,
  box: { x: 0.2, y: 0.7, width: 0.6, height: 0.05 },
  appearance: { size: 0.03, align: 'center', case: 'mixed', background: 'none' },
  styleKey: 'label',
  reveal: 'none',
  language: 'en',
  origin: 'template',
} as const;

describe('the overlay placement relation (§2)', () => {
  it('names its sides and zones', () => {
    expect(OVERLAY_PLACEMENT_SIDES).toEqual(['left', 'right', 'above', 'below']);
    expect(OVERLAY_PLACEMENT_ZONES).toEqual(['top', 'middle', 'bottom']);
  });

  it('beside the subject, or a band of the frame', () => {
    const beside = { relativeTo: 'subject', side: 'right', zone: 'top', gap: 0.4 } as const;
    expect(overlayPlacementSchema.parse(beside)).toEqual(beside);
    expect(overlayPlacementSchema.parse({ relativeTo: 'frame', zone: 'bottom' })).toEqual({
      relativeTo: 'frame',
      zone: 'bottom',
    });
    expect(overlayPlacementSchema.safeParse({ relativeTo: 'subject', zone: 'side' }).success).toBe(false);
    expect(overlayPlacementSchema.safeParse({ relativeTo: 'frame', zone: 'top', gap: -1 }).success).toBe(
      false,
    );
  });

  it('is optional on a design: one from before FRM1 parses unchanged', () => {
    expect(overlayDesignSchema.parse(design)).not.toHaveProperty('placement');
    const placed = { ...design, placement: { relativeTo: 'subject', side: 'left', zone: 'middle' } };
    expect(overlayDesignSchema.parse(placed).placement?.side).toBe('left');
  });
});

describe('a made item’s placement record (§2)', () => {
  it('names the solver’s reasons, the fallbacks in order', () => {
    expect(PLACEMENT_REASONS).toEqual(['asReel', 'moved', 'shrunk', 'retimed', 'recast', 'noRoom']);
    expect(madePlacementSchema.safeParse({ reason: 'guessed' }).success).toBe(false);
  });

  it('a graphic’s box may say why the solver chose it; a box without one still parses', () => {
    expect(graphicItemSchema.parse(graphic).placement).toEqual(graphic.placement);
    const solved = { ...graphic, placement: { ...graphic.placement, reason: 'moved' } };
    expect(graphicItemSchema.parse(solved).placement).toMatchObject({ reason: 'moved' });
    expect(graphicItemSchema.parse({ ...graphic, placement: 'top' }).placement).toBe('top');
  });

  it('a text item may say why its box is there', () => {
    expect(textItemSchema.parse(text)).not.toHaveProperty('placement');
    expect(textItemSchema.parse({ ...text, placement: { reason: 'shrunk' } }).placement?.reason).toBe(
      'shrunk',
    );
  });
});

describe('graphicCoversFace', () => {
  it('is a QA check, after every earlier one', () => {
    expect(QA_CHECK_IDS.slice(31, 32)).toEqual(['graphicCoversFace']);
  });
});
