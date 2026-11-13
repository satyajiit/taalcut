// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { aiInventory } from '../../src/credentials/ai-inventory';
import { partsTimeline } from './support';

describe('aiInventory', () => {
  it("finds nothing generated in captured footage with the person's own track", () => {
    const { timeline, provenanceOf } = partsTimeline({ clips: [false, false], music: 'ownTrack' });
    const inventory = aiInventory(timeline, provenanceOf);
    expect(inventory.parts.map((part) => part.title)).toEqual(['clip 1', 'clip 2', 'music']);
    expect(inventory.generated).toEqual([]);
    expect(inventory.allGenerated).toBe(false);
  });

  it('names a generated clip by its place, never by its asset', () => {
    const { timeline, provenanceOf } = partsTimeline({ clips: [false, true, false] });
    const inventory = aiInventory(timeline, provenanceOf);
    expect(inventory.generated.map((part) => [part.kind, part.title, part.label])).toEqual([
      ['clip', 'clip 2', 'clip-2'],
    ]);
    for (const part of inventory.parts) expect(part.title).not.toContain(String(part.assetId));
  });

  it('counts voiceover lines as generated whatever the library says about their files', () => {
    const { timeline, provenanceOf } = partsTimeline({
      clips: [false],
      voice: [false, false],
      voiceoverLines: [1],
    });
    const inventory = aiInventory(timeline, provenanceOf);
    expect(inventory.parts.filter((part) => part.kind === 'voiceover').map((part) => part.generated)).toEqual(
      [false, true],
    );
    expect(inventory.generated.map((part) => part.title)).toEqual(['voiceover 2']);
  });

  it('reads sound effects by their asset and music by its path', () => {
    const sfx = partsTimeline({ clips: [false], sfx: [true, false] });
    const effects = aiInventory(sfx.timeline, sfx.provenanceOf);
    expect(effects.generated.map((part) => part.title)).toEqual(['sound effect 1']);
    const generatedMusic = partsTimeline({ clips: [false], music: 'generated' });
    expect(
      aiInventory(generatedMusic.timeline, generatedMusic.provenanceOf).generated.map((part) => part.id),
    ).toEqual(['music']);
    const generatedTrack = partsTimeline({ clips: [false], music: 'generatedTrack' });
    expect(
      aiInventory(generatedTrack.timeline, generatedTrack.provenanceOf).generated.map((part) => part.id),
    ).toEqual(['music']);
    const reference = partsTimeline({ clips: [false], music: 'referenceAudio' });
    expect(aiInventory(reference.timeline, reference.provenanceOf).generated).toEqual([]);
  });

  it('leaves platform sound out (nothing is in the file) and says all-generated only when every part is', () => {
    const silent = partsTimeline({ clips: [true, true], music: 'platformSound' });
    const all = aiInventory(silent.timeline, silent.provenanceOf);
    expect(all.parts).toHaveLength(2);
    expect(all.allGenerated).toBe(true);
    const mixed = partsTimeline({ clips: [true, true], music: 'ownTrack' });
    expect(aiInventory(mixed.timeline, mixed.provenanceOf).allGenerated).toBe(false);
  });

  it('skips disabled clips and treats an unknown asset as captured', () => {
    const { timeline } = partsTimeline({ clips: [true, true] });
    const disabled = {
      ...timeline,
      tracks: timeline.tracks.map((track) =>
        track.kind === 'video'
          ? {
              ...track,
              items: track.items.map((item, index) =>
                index === 0 && item.type === 'clip' ? { ...item, enabled: false } : item,
              ),
            }
          : track,
      ),
    };
    const inventory = aiInventory(disabled, () => null);
    expect(inventory.parts.map((part) => part.title)).toEqual(['clip 1']);
    expect(inventory.generated).toEqual([]);
  });
});
