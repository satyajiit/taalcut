// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-QA: a portrait reel's text on a portrait video keeps its box, unless the reel had it where the made video's
 * safe area ends (a title by the canvas edge): then it lands just inside, the same size, so QA doesn't fail it
 * from the start. Made-up overlays.
 */
import { describe, expect, it } from 'vitest';
import { newId, RationalTime, type TextItem, type TextTrackItem, type Track } from '@taalcut/core';
import { fitTextTracks, MADE_SAFE_AREAS, textMargin } from '../src/assembly/fit-layout';

const PORTRAIT = { width: 1080, height: 1920 };
const rate = { num: 30, den: 1 };

function title(box: TextItem['box'], overlay = true): TextItem {
  return {
    type: 'text',
    id: newId<'TimelineItem'>(),
    start: RationalTime.of(0, rate),
    duration: RationalTime.of(60, rate),
    text: 'A made-up title',
    role: 'title',
    slotId: null,
    overlayId: overlay ? newId<'TextOverlay'>() : null,
    box,
    appearance: { size: 0.02, align: 'right', case: 'mixed', background: 'none' },
    styleKey: 'title',
    reveal: 'none',
    language: null,
    origin: 'template',
  };
}

const track = (items: TextTrackItem[]): Extract<Track, { kind: 'text' }> => ({
  kind: 'text',
  id: 'T1',
  name: 'T1',
  enabled: true,
  items,
});

describe('fitTextTracks on a canvas of the template’s own shape', () => {
  it('preserves a title centered on the camera-roll canvas', () => {
    const source = title({ x: 0.18, y: 0.29, width: 0.64, height: 0.045 });
    const centered: TextItem = { ...source, appearance: { ...source.appearance, align: 'center' } };
    const [fitted] = fitTextTracks([track([centered])], PORTRAIT, PORTRAIT);
    expect(fitted!.items[0]).toEqual(centered);
  });

  it('moves a template title near the canvas edge just inside the safe area, at its size', () => {
    const rail = title({ x: 0.89, y: 0.46, width: 0.1, height: 0.04 });
    const [fitted] = fitTextTracks([track([rail])], PORTRAIT, PORTRAIT);
    const moved = fitted!.items[0] as TextItem;
    const safe = MADE_SAFE_AREAS.portrait;
    const margin = textMargin(0.02, PORTRAIT) / PORTRAIT.width;
    expect(moved.box.x + moved.box.width).toBeCloseTo(safe.x + safe.width - margin, 9);
    expect(moved.box.width).toBeCloseTo(0.1, 9);
    expect(moved.box.y).toBeCloseTo(0.46, 9);
    expect(moved.appearance).toEqual(rail.appearance);
  });

  it('leaves a title already inside, and text that is not the template’s, exactly as they are', () => {
    const inside = title({ x: 0.3, y: 0.4, width: 0.3, height: 0.05 });
    const own = title({ x: 0.82, y: 0.46, width: 0.1, height: 0.04 }, false);
    const [fitted] = fitTextTracks([track([inside, own])], PORTRAIT, PORTRAIT);
    expect(fitted!.items).toEqual([inside, own]);
  });
});
