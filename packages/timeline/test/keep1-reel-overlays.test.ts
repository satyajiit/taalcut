// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: words and graphics the reel burned into its picture are not drawn a second time over a slot that keeps the
 * reel's footage. The rule sits where overlays become items (assemble.ts hands text.ts the template without them):
 * an overlay over the person's clips is drawn as before, one wholly over the reel's footage is left out, and one
 * that runs across the boundary is cut to its time over the person's clip when that is most of it.
 */
import type { TextItem, Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { withoutReelOverlays } from '../src/assembly/reel-footage';
import { agentWorldOver } from './fixtures/agent';
import { reelSource, reelWorld } from './fixtures/reel';
import type { OverlayDef } from './fixtures/template';

const texts = (timeline: Timeline) =>
  timeline.tracks
    .flatMap((track) => (track.kind === 'text' ? track.items : []))
    .filter((item): item is TextItem => item.type === 'text')
    .map((item) => [item.text, item.start.value, item.duration.value] as const)
    .sort((a, b) => a[1] - b[1]);

async function assembled(kept: readonly number[], overlays: readonly OverlayDef[], clips = 1) {
  const cast = reelWorld({ kept, overlays, clips });
  const w = agentWorldOver(cast, { keptAudio: true, reel: reelSource().source });
  const done = await w.call('timeline.assemble', {
    projectId: w.projectId,
    template: { id: cast.template.id },
  });
  if (!done.ok) throw new Error(done.error.code);
  return { cast, timeline: w.store.docs.get((done.value.timelineIds as string[])[0]!)! };
}

/** The owner's reel: slot 0 is frames 0–323, the film is 324–466. */
const OVERLAYS: readonly OverlayDef[] = [
  { start: 10, frames: 120, text: 'POV: you ask for a raise', slot: 0 },
  { start: 150, frames: 150, text: 'my boss:', slot: 0, box: { x: 0.1, y: 0.3, width: 0.8, height: 0.1 } },
  { start: 330, frames: 100, text: 'I am Iron Man', slot: 1 },
  { start: 454, frames: 12, text: 'THE END', slot: 2 },
];

describe('overlays over a slot that keeps the reel’s footage (KEEP1)', () => {
  it('draws the overlays over the person’s clip as before and none over the reel’s footage', async () => {
    const { timeline } = await assembled([1, 2], OVERLAYS);
    expect(texts(timeline)).toEqual([
      ['POV: you ask for a raise', 10, 120],
      ['my boss:', 150, 150],
    ]);
    // With nothing kept, the same template draws all four: the rule is only the statement's.
    const all = await assembled([], OVERLAYS, 3);
    expect(texts(all.timeline).map(([text]) => text)).toEqual([
      'POV: you ask for a raise',
      'my boss:',
      'I am Iron Man',
      'THE END',
    ]);
  });

  it('cuts an overlay that runs across the boundary to its time over the person’s clip', async () => {
    const across: readonly OverlayDef[] = [
      // Mostly over the person's clip, 16 frames into the film: it ends where the film begins.
      { start: 200, frames: 140, text: 'wait for it', slot: 0 },
      // Mostly over the film, 14 frames back into the person's clip: the reel's own, left out.
      { start: 310, frames: 140, text: 'subtitle', slot: 0 },
    ];
    const { timeline } = await assembled([1, 2], across);
    expect(texts(timeline)).toEqual([['wait for it', 200, 124]]);
  });

  it('with the reel’s footage first, an overlay starts where the person’s clip does', async () => {
    const across: readonly OverlayDef[] = [
      { start: 300, frames: 100, text: 'and then me', slot: 0 },
      { start: 20, frames: 60, text: 'film title', slot: 0 },
    ];
    const { cast, timeline } = await assembled([0], across, 2);
    expect(texts(timeline)).toEqual([['and then me', 324, 76]]);
    const item = timeline.tracks
      .flatMap((track) => (track.kind === 'text' ? track.items : []))
      .find((entry): entry is TextItem => entry.type === 'text')!;
    // It belongs to the person's slot it now shows over, and still names the template's overlay.
    expect(item.slotId).toBe(cast.template.slots[1]!.id);
    expect(item.overlayId).toBe(cast.template.text[0]!.id);
  });

  it('leaves a template with no reel slot exactly as it is', () => {
    const cast = reelWorld({ kept: [], overlays: OVERLAYS });
    expect(withoutReelOverlays(cast.template)).toBe(cast.template);
    const kept = reelWorld({ kept: [1, 2], overlays: OVERLAYS.slice(0, 2) });
    // Every overlay already over the person's clip: nothing to change either.
    expect(withoutReelOverlays(kept.template)).toBe(kept.template);
  });
});
