// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-GFX: the graphics lane's model. Graphics on the text tracks by time, a proposal marked; a drag moves or trims
 * one within the video and core's half-second-to-fifteen-seconds; the graphics.edit change is a time anchor, plus
 * a length when it changed; a selected graphic is an item chip.
 */
import type { GraphicComposition, GraphicItem, Timeline, TimelineItemId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { seedProjects } from '../src/backend/fake/make/seed';
import {
  dragEdit,
  dragged,
  graphicRows,
  graphicViewsOf,
  lengthLimits,
} from '../src/features/timeline/graphics-lane-model';
import { toChip } from '../src/features/timeline/selection';

const golden = seedProjects()
  .projects.flatMap((project) => project.timelines)
  .find((timeline) => timeline.id === GOLDEN_TIMELINES[0])!;
const rate = golden.canvas.rate;

/** A made-up design's record (no files to draw): its one text variable holds a graphic's words. */
const design = {
  id: '01K7C5M6Q8R9S0T1V2W3X4DS01',
  version: 1,
  hash: 'd'.repeat(64),
  name: 'Name card',
  entry: 'index.html',
  files: [{ path: 'index.html', sha256: 'e'.repeat(64), bytes: 900 }],
  variables: [{ type: 'text', name: 'name', maxLength: 60, sample: 'Made-up name' }],
  durationSeconds: 3,
  provenance: { model: null, overlays: [], brief: null, createdAt: 0 },
  gate: {
    version: '1',
    passed: true,
    checkedAt: 0,
    hfLint: { errors: 0, warnings: 0 },
    checks: [],
    loweredTweens: 2,
  },
} as unknown as GraphicComposition;

function graphic(id: string, at: number, frames: number, proposed = false): GraphicItem {
  return {
    type: 'graphic',
    id: id as TimelineItemId,
    anchor: { kind: 'time', at: { value: at, rate } },
    start: { value: at, rate },
    duration: { value: frames, rate },
    placement: { box: { x: 0.1, y: 0.7, width: 0.8, height: 0.1 } },
    styleKey: 'composition',
    language: 'en',
    origin: 'agent',
    composition: { id: design.id, hash: design.hash, params: { name: 'Asha Rao' } },
    ...(proposed ? { proposal: { request: 'a lower third', design: 'designed', createdAt: 1 } } : {}),
  } as GraphicItem;
}

const withGraphics = (...items: GraphicItem[]): Timeline => ({
  ...golden,
  tracks: [...golden.tracks, { kind: 'text', id: 'T9', name: '', enabled: true, items }],
  graphicCompositions: [design],
});

describe('the graphics lane (EDT1-GFX)', () => {
  it('lists the graphics by time with their words, a proposal marked', () => {
    const views = graphicViewsOf(
      withGraphics(
        graphic('01K7C5M6Q8R9S0T1V2W3X4GR02', 90, 60, true),
        graphic('01K7C5M6Q8R9S0T1V2W3X4GR01', 30, 60),
      ),
    );
    expect(views.map((view) => [view.start, view.end, view.words, view.proposed, view.row])).toEqual([
      [30, 90, 'Asha Rao', false, 0],
      [90, 150, 'Asha Rao', true, 0],
    ]);
    // Two at the same time stack, so each can be grabbed.
    const stacked = graphicViewsOf(
      withGraphics(
        graphic('01K7C5M6Q8R9S0T1V2W3X4GR01', 30, 60),
        graphic('01K7C5M6Q8R9S0T1V2W3X4GR02', 60, 60),
      ),
    );
    expect(stacked.map((view) => view.row)).toEqual([0, 1]);
    expect(graphicRows(stacked)).toBe(2);
    expect(graphicViewsOf(golden).filter((view) => view.trackId === 'T9')).toEqual([]);
  });

  it('a drag moves it on the video and trims it within half a second and fifteen', () => {
    const { min, max } = lengthLimits(rate);
    const from = { start: 30, end: 90 };
    expect(dragged(from, 'move', 20, 300, rate)).toEqual({ start: 50, end: 110 });
    expect(dragged(from, 'move', -100, 300, rate)).toEqual({ start: 0, end: 60 });
    expect(dragged(from, 'move', 500, 300, rate)).toEqual({ start: 240, end: 300 });
    expect(dragged(from, 'end', -100, 300, rate)).toEqual({ start: 30, end: 30 + min });
    expect(dragged(from, 'end', 10_000, 100_000, rate)).toEqual({ start: 30, end: 30 + max });
    expect(dragged(from, 'start', 100, 300, rate)).toEqual({ start: 90 - min, end: 90 });
    expect(dragged(from, 'start', -100, 300, rate)).toEqual({ start: 0, end: 90 });
  });

  it('the change is a time anchor, and a length when it changed; nothing when it did not move', () => {
    const view = { start: 30, end: 90 };
    expect(dragEdit(view, { start: 30, end: 90 }, rate)).toBeNull();
    expect(dragEdit(view, { start: 50, end: 110 }, rate)).toEqual({
      anchor: { kind: 'time', at: { value: 50, rate } },
    });
    expect(dragEdit(view, { start: 30, end: 120 }, rate)).toEqual({
      anchor: { kind: 'time', at: { value: 30, rate } },
      duration: { value: 90, rate },
    });
  });

  it('a selected graphic is an item chip for the chat', () => {
    const itemId = '01K7C5M6Q8R9S0T1V2W3X4GR01' as TimelineItemId;
    expect(toChip({ kind: 'item', itemId, itemKind: 'graphic' }, golden.id, rate)).toEqual({
      kind: 'item',
      timelineId: golden.id,
      itemId,
      itemKind: 'graphic',
    });
  });
});
