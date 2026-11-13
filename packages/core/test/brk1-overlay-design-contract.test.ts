// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-GFX's contract §3: an overlay's design (its kind, colours, corners and tail, type and motion) on a text
 * overlay. Additive: an overlay from before BRK1 has none and still parses, and so does a whole template.
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  OVERLAY_DESIGN_KINDS,
  OVERLAY_ENTRANCES,
  OVERLAY_EXITS,
  overlayDesignSchema,
  RationalTime,
  textOverlaySchema,
  type OverlayDesign,
} from '../src';

const rate = { num: 30, den: 1 };

const overlay = {
  id: newId<'TextOverlay'>(),
  text: 'Made-up words',
  role: 'label',
  start: RationalTime.of(7, rate),
  duration: RationalTime.of(129, rate),
  slotId: null,
  box: { x: 0.3, y: 0.24, width: 0.14, height: 0.035 },
  appearance: { size: 0.024, align: 'left', case: 'mixed', background: 'none' },
  styleKey: 'label',
  reveal: 'none',
  language: 'en',
  confidence: 1,
} as const;

const bubble = {
  kind: 'chatBubble',
  colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
  cornerRadius: 0.32,
  tail: 'right',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'none', exit: 'none', typing: false },
  shape: { x: 0.25, y: 0.21, width: 0.27, height: 0.06 },
  confidence: 0.86,
} as const;

describe('overlay design (§3)', () => {
  it('names the kinds, entrances and exits of the contract', () => {
    expect(OVERLAY_DESIGN_KINDS).toEqual([
      'plain',
      'chatBubble',
      'pill',
      'label',
      'lowerThird',
      'sticker',
      'callout',
      'cta',
      'kineticTitle',
    ]);
    expect(OVERLAY_ENTRANCES).toEqual([
      'none',
      'fade',
      'pop',
      'slide',
      'typewriter',
      'wordByWord',
      'unknown',
    ]);
    expect(OVERLAY_EXITS).toEqual(['none', 'fade', 'pop', 'slide', 'unknown']);
  });

  it('parses a chat bubble and defaults its tail to none', () => {
    const parsed: OverlayDesign = overlayDesignSchema.parse(bubble);
    expect(parsed.tail).toBe('right');
    const { tail: _tail, ...withoutTail } = bubble;
    expect(overlayDesignSchema.parse(withoutTail).tail).toBe('none');
    // BRK1 gate: read ticks are optional.
    expect(overlayDesignSchema.parse(bubble).receipt).toBeUndefined();
    expect(overlayDesignSchema.parse({ ...bubble, receipt: true }).receipt).toBe(true);
  });

  it('refuses colours that are not #rrggbb, a radius past a pill and an unknown kind', () => {
    const bad = (patch: object) => overlayDesignSchema.safeParse({ ...bubble, ...patch }).success;
    expect(bad({ colors: { ...bubble.colors, text: 'red' } })).toBe(false);
    expect(bad({ colors: { ...bubble.colors, fill: '#FFFFFF' } })).toBe(false);
    expect(bad({ cornerRadius: 0.6 })).toBe(false);
    expect(bad({ kind: 'speechBalloon' })).toBe(false);
    expect(bad({ font: { class: 'sans', weight: 950 } })).toBe(false);
    expect(bad({ shape: { x: 0.9, y: 0, width: 0.2, height: 0.1 } })).toBe(false);
    expect(bad({ colors: { fill: null, text: '#ffffff', stroke: '#000000' }, kind: 'plain' })).toBe(true);
  });

  it('is optional on a text overlay: one from before BRK1 still parses', () => {
    expect(textOverlaySchema.parse(overlay).design).toBeUndefined();
    expect(textOverlaySchema.parse({ ...overlay, design: bubble }).design?.kind).toBe('chatBubble');
    expect(textOverlaySchema.safeParse({ ...overlay, design: { kind: 'chatBubble' } }).success).toBe(false);
  });
});
