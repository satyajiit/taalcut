// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-asset Set-of-Mark contact sheet (`vision.contactSheet`): temporal tile planning across single-shot camera
 * clips and multi-shot reels, stage skipping before analysis, and `derived` file registration from job output.
 */
import { FrameRate, newId, RationalTime, TimeRange, unwrap, type AssetIndexView } from '@taalcut/core';
import { derivedKey } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import {
  CONTACT_SHEET_RECIPE,
  CONTACT_SHEET_STAGE,
  contactSheetTilesForAsset,
  createContactSheetStage,
  visionIndexContactSheetJob,
} from '../../src/jobs/contact-sheet-stage';
import { fakeAnalysis } from '../helpers/shot-analysis';

const RATE = FrameRate.of(30);
const range = (start: number, frames: number) =>
  TimeRange.of(RationalTime.of(start, RATE), RationalTime.of(frames, RATE));

describe('vision.contactSheet stage and tile planner', () => {
  it('expands a single 9 s camera clip into a chronological multi-tile spread anchored on bestFrame', () => {
    const shotId = newId<'Shot'>();
    const tiles = contactSheetTilesForAsset([{ shotId, range: range(0, 270), bestFrame: 42 }], RATE);
    expect(tiles.length).toBeGreaterThanOrEqual(5);
    expect(tiles.length).toBeLessThanOrEqual(8);
    expect(tiles.every((t) => t.shotId === shotId)).toBe(true);
    expect(tiles.map((t) => t.frame)).toContain(42);
    // Strictly ascending frame order.
    for (let i = 1; i < tiles.length; i++) {
      expect(tiles[i]!.frame).toBeGreaterThan(tiles[i - 1]!.frame);
    }
  });

  it('uses one bestFrame tile per shot on multi-shot clips (16+ shots) up to the 60-tile cap', () => {
    const shots = Array.from({ length: 20 }, (_, i) => ({
      shotId: newId<'Shot'>(),
      range: range(i * 60, 60),
      bestFrame: 15,
    }));
    const tiles = contactSheetTilesForAsset(shots, RATE);
    expect(tiles).toHaveLength(20);
    expect(tiles.map((t) => t.frame)).toEqual(shots.map((_, i) => i * 60 + 15));
  });

  it('skips unanalysed views, plans vision.indexContactSheet once analysed, and extracts derived file ref', () => {
    const stage = createContactSheetStage('original');
    expect(stage.stage).toBe(CONTACT_SHEET_STAGE);
    expect(stage.milestone).toBe('complete');
    expect(stage.appliesTo).toEqual(['video', 'live_photo']);

    const hash = 'ab'.repeat(32);
    const shotId = newId<'Shot'>();
    const baseView: AssetIndexView = {
      assetId: newId<'Asset'>(),
      generation: 1,
      kind: 'video',
      path: '/clips/take.mov',
      contentHash: hash,
      sizeBytes: 4096,
      sourceId: newId<'Source'>(),
      capturedAt: null,
      facts: null,
      derived: [],
      shots: [{ shotId, range: range(0, 180), analysis: null }],
      transcript: null,
      outputs: {},
    };
    expect(stage.job(baseView)).toEqual({ skip: 'indexing.skip.notAnalysed' });

    const analysedView: AssetIndexView = {
      ...baseView,
      shots: [{ shotId, range: range(0, 180), analysis: fakeAnalysis(range(0, 180), { bestFrame: 30 }) }],
    };
    const planned = stage.job(analysedView);
    expect('kind' in planned && planned.kind).toBe(visionIndexContactSheetJob);
    if ('skip' in planned) throw new Error('expected job');
    const input = planned.input as { tiles: { frame: number; shotId: string }[] };
    expect(input.tiles.some((t) => t.frame === 30 && t.shotId === shotId)).toBe(true);

    const key = derivedKey('still', hash, CONTACT_SHEET_RECIPE, 'jpg', 'contact-sheet');
    const file = {
      kind: 'still' as const,
      key,
      bytes: 12_345,
      mimeType: 'image/jpeg' as const,
      width: 960,
      height: 270,
      frameRate: RATE,
      recipe: CONTACT_SHEET_RECIPE,
    };
    const res = unwrap(
      stage.result!(
        {
          contactSheet: {
            file,
            width: 960,
            height: 270,
            columns: 4,
            tileWidth: 240,
            tileHeight: 135,
            frameRate: RATE,
            layout: [{ tile: 0, frame: 30, at: RationalTime.of(30, RATE), shotId }],
          },
        },
        analysedView,
      ),
    );
    expect(res.derived).toEqual([file]);
  });
});
