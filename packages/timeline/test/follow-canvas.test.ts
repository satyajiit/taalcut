// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE: the made video's canvas follows the person's clips (the owner's decision, 2026-10-31). A landscape
 * reel's template cast from portrait phone clips makes a portrait 9:16 video. The clips are then a strict fit, not
 * relaxed and capped at 0.2. A canvas the request names, story order, and clips mostly of the template's own
 * orientation keep the template's. The overlays keep their place on the frame and their size in pixels, inside the
 * vertical safe area, and swaps on the made video look for clips of its orientation.
 */
import { newId, type OverlayDesign, type ShotProfile, type Template, type TextItem } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../src/casting/config';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createCastingEngine } from '../src/casting/engine';
import { followedOrientation, madeCanvas } from '../src/casting/follow-canvas';
import { fitBox, fitTextSize, fitTextTracks, MADE_SAFE_AREAS, textMargin } from '../src/assembly/fit-layout';
import { agentWorldOver } from './fixtures/agent';
import type { World } from './fixtures/casting';
import { fakeEmbedder, makeProfile, near, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const projectId = newId<'Project'>();
const REEL = { width: 1080, height: 608 };
const BUBBLE: OverlayDesign = {
  kind: 'chatBubble',
  colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
  cornerRadius: 0.32,
  tail: 'left',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'none', exit: 'none', typing: false },
  shape: { x: 0.05, y: 0.2, width: 0.4, height: 0.1 },
  confidence: 0.9,
};

/** A landscape reel's 13 slots, a bubble and a caption, and a library of `portrait` and `landscape` clips. */
function reelWorld(clips: { portrait: number; landscape: number }): World {
  const intents = Array.from({ length: 13 }, (_, index) => unitVector(7_001 + index));
  const built = buildTemplate({
    slots: intents.map((_, index) => ({ frames: 30, text: `shot ${index}` })),
    overlays: [
      { start: 10, frames: 60, text: 'Made-up question?', slot: 0, design: BUBBLE },
      { start: 100, frames: 60, text: 'A caption', slot: 3 },
    ],
  });
  const template: Template = { ...built, canvas: { ...built.canvas, ...REEL } };
  const orientations: ShotProfile['orientation'][] = [
    ...Array<'portrait'>(clips.portrait).fill('portrait'),
    ...Array<'landscape'>(clips.landscape).fill('landscape'),
  ];
  const profiles = orientations.map((orientation, index) =>
    makeProfile({ embedding: near(intents[index % 13]!, 300 + index, 0.1), orientation }),
  );
  const table = new Map(intents.map((vector, index) => [`shot ${index}`, vector]));
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
  });
  return { template, profiles, acceptable: [], engine };
}

const cast = (w: World, extra: object = {}) =>
  w.engine.cast({ projectId, template: w.template, mode: 'template', variants: 1, seed: 1, ...extra });

describe('the made video follows the clips (BRK1-MAKE)', () => {
  it('casts a landscape reel from portrait clips for a portrait 9:16 video, every clip a fit', async () => {
    const w = reelWorld({ portrait: 11, landscape: 0 });
    // Before: on the reel's own canvas (now only when a person names it), every pick is relaxed and capped.
    const before = await cast(w, { canvas: REEL });
    if (!before.ok) throw new Error(before.error.code);
    const relaxed = before.value.variants[0]!.slots.filter((slot) => slot.pick);
    expect(relaxed.every((slot) => slot.note === 'orientationRelaxed')).toBe(true);
    expect(relaxed.every((slot) => slot.confidence! <= CASTING_CONFIG.candidates.relaxedConfidenceCap)).toBe(
      true,
    );
    expect(relaxed.every((slot) => slot.needsRerank)).toBe(true);

    const after = await cast(w);
    if (!after.ok) throw new Error(after.error.code);
    expect(after.value.canvas).toEqual({ ...w.template.canvas, width: 1080, height: 1920 });
    const slots = after.value.variants[0]!.slots;
    const picked = slots.filter((slot) => slot.pick);
    expect(picked).toHaveLength(11);
    expect(picked.some((slot) => slot.note === 'orientationRelaxed')).toBe(false);
    expect(picked.every((slot) => slot.confidence! > CASTING_CONFIG.candidates.relaxedConfidenceCap)).toBe(
      true,
    );
    expect(slots.filter((slot) => slot.note === 'noCandidates')).toHaveLength(2);

    // A few landscape clips in a mostly portrait library must not starve the remaining slots or lock the canvas.
    const mixed = await cast(reelWorld({ portrait: 13, landscape: 2 }));
    if (!mixed.ok) throw new Error(mixed.error.code);
    expect(mixed.value.canvas).toEqual({ ...w.template.canvas, width: 1080, height: 1920 });
    expect(mixed.value.variants[0]!.slots.every((slot) => slot.pick !== null)).toBe(true);
  });

  it('keeps the template’s canvas when most clips are its orientation, and for story order', async () => {
    const mostly = await cast(reelWorld({ portrait: 3, landscape: 10 }));
    if (!mostly.ok) throw new Error(mostly.error.code);
    expect(mostly.value.canvas).toMatchObject(REEL);
    const story = await cast(reelWorld({ portrait: 11, landscape: 2 }), { mode: 'story' });
    if (!story.ok) throw new Error(story.error.code);
    expect(story.value.canvas).toMatchObject(REEL);
  });

  it('follows only a majority, never a tie, and sizes the made canvas like the export presets', () => {
    expect(followedOrientation(['portrait', 'portrait', 'landscape'], 'landscape')).toBe('portrait');
    expect(followedOrientation(['portrait', 'landscape'], 'landscape')).toBeNull();
    expect(followedOrientation(['landscape', 'landscape', 'portrait'], 'landscape')).toBeNull();
    expect(followedOrientation([], 'landscape')).toBeNull();
    const rate = { num: 30, den: 1 };
    expect(madeCanvas({ ...REEL, rate }, 'portrait')).toEqual({ width: 1080, height: 1920, rate });
    expect(madeCanvas({ ...REEL, rate }, 'landscape')).toEqual({ ...REEL, rate });
    expect(madeCanvas({ width: 1080, height: 1920, rate }, 'square')).toEqual({
      width: 1080,
      height: 1080,
      rate,
    });
  });

  it('assembles the portrait video with the reel’s text in place, at its size, inside the safe area', async () => {
    const w = agentWorldOver(reelWorld({ portrait: 11, landscape: 0 }));
    const made = await w.call('timeline.assemble', {
      projectId: w.projectId,
      template: { id: w.template.id },
    });
    if (!made.ok) throw new Error(made.error.code);
    const timeline = w.store.docs.get((made.value.timelineIds as string[])[0]!)!;
    expect(timeline.canvas).toMatchObject({ width: 1080, height: 1920 });
    const items = timeline.tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));
    // HFW1 retire: the reel's bubble has no composition in this template, so it is left out (no built-in graphic).
    expect(items.some((item) => item.type === 'graphic')).toBe(false);
    const caption = items.find((item): item is TextItem => item.type === 'text')!;
    const safe = MADE_SAFE_AREAS.portrait;
    const inside = (box: { x: number; y: number; width: number; height: number }) =>
      box.x >= safe.x - 1e-9 &&
      box.y >= safe.y - 1e-9 &&
      box.x + box.width <= safe.x + safe.width + 1e-9 &&
      box.y + box.height <= safe.y + safe.height + 1e-9;
    expect(inside(caption.box)).toBe(true);
    expect(caption.appearance.size).toBeCloseTo((0.05 * 608) / 1920, 9);
    // Every clip fills the frame with a centre crop.
    const clips = timeline.tracks.flatMap((track) => (track.kind === 'video' ? track.items : []));
    expect(clips.filter((item) => item.type === 'clip').every((item) => item.fit === 'cover')).toBe(true);
  });

  it('keeps a text a margin inside the safe area, where render draws its padding and line boxes', async () => {
    // On the owner's path a sign's text at the reel's top right sat flush with the safe area and QA measured it
    // 10 to 27 px outside: render's box padding, outline and line boxes reach past the item's box.
    const w = agentWorldOver(reelWorld({ portrait: 11, landscape: 0 }));
    const made = await w.call('timeline.assemble', {
      projectId: w.projectId,
      template: { id: w.template.id },
    });
    if (!made.ok) throw new Error(made.error.code);
    const timeline = w.store.docs.get((made.value.timelineIds as string[])[0]!)!;
    const track = timeline.tracks.find((t) => t.kind === 'text' && t.items.some((i) => i.type === 'text'));
    if (track?.kind !== 'text') throw new Error('no text track');
    const caption = track.items.find((item): item is TextItem => item.type === 'text')!;
    const sign: TextItem = {
      ...caption,
      box: { x: 0.8, y: 0.02, width: 0.18, height: 0.06 },
      appearance: { ...caption.appearance, size: 0.05 },
    };
    const portrait = { width: 1080, height: 1920 };
    const [fitted] = fitTextTracks([{ ...track, items: [sign] }], REEL, portrait);
    const item = fitted!.items[0] as TextItem;
    const safe = MADE_SAFE_AREAS.portrait;
    const margin = textMargin(item.appearance.size, portrait);
    expect(margin).toBeCloseTo(20 + 0.3 * 0.05 * 608, 6);
    expect(item.box.x + item.box.width).toBeCloseTo(safe.x + safe.width - margin / 1080, 9);
    expect(item.box.y).toBeCloseTo(safe.y + margin / 1920, 9);
    // Its pixels are kept.
    expect(item.box.width).toBeCloseTo(0.18, 9);
  });

  it('fits a box by its centre and pixels, and keeps it on the frame when it is bigger than the safe area', () => {
    const portrait = { width: 1080, height: 1920 };
    const safe = MADE_SAFE_AREAS.portrait;
    const wide = fitBox({ x: 0, y: 0.45, width: 1, height: 0.1 }, REEL, portrait);
    expect(wide.x).toBeCloseTo(safe.x, 9);
    expect(wide.width).toBeCloseTo(safe.width, 9);
    expect(wide.y + wide.height / 2).toBeCloseTo(0.5, 9);
    // A caption near the bottom stays inside the device copy's title margins.
    const low = fitBox({ x: 0.1, y: 0.93, width: 0.8, height: 0.06 }, REEL, portrait);
    expect(low.y + low.height).toBeCloseTo(safe.y + safe.height, 9);
    const inside = fitBox({ x: 0.1, y: 0.8, width: 0.8, height: 0.1 }, REEL, portrait);
    expect(inside.y + inside.height / 2).toBeCloseTo(0.85, 9);
    // A portrait template on a landscape video: the frame is scaled to fit, so its pixels shrink with it.
    const landscape = { width: 1920, height: 1080 };
    expect(fitTextSize(0.05, portrait, landscape)).toBeCloseTo((0.05 * 1920 * (1080 / 1920)) / 1080, 9);
  });

  it('looks for alternates of the made video’s orientation', async () => {
    const w = reelWorld({ portrait: 6, landscape: 6 });
    const slot = w.template.slots[0]!;
    const orientationOf = new Map(w.profiles.map((profile) => [profile.shotId, profile.orientation]));
    const request = {
      template: w.template,
      slotId: slot.id,
      previous: null,
      next: null,
      used: [],
      exclude: [],
      limit: 3,
    };
    const own = await w.engine.alternates(request);
    const portrait = await w.engine.alternates({ ...request, canvas: { width: 1080, height: 1920 } });
    if (!own.ok || !portrait.ok) throw new Error('alternates failed');
    expect(own.value.every((candidate) => orientationOf.get(candidate.shotId!) === 'landscape')).toBe(true);
    expect(portrait.value.length).toBeGreaterThan(0);
    expect(portrait.value.every((candidate) => orientationOf.get(candidate.shotId!) === 'portrait')).toBe(
      true,
    );
  });
});
