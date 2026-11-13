// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GAPS: a pick under casting's confidence line is a gap too. Its swap candidates are the cast's alternates, best
 * fit first, and one clearly fits better only when the pick fits under casting's line and the candidate over it.
 * Made-up clips only.
 */
import {
  FrameRates,
  newId,
  RationalTime,
  type CastCandidate,
  type ShotProfile,
  type SlotCast,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { CASTING_CONFIG as config } from '../../src/casting/config';
import { createCastingEngine } from '../../src/casting/engine';
import { isWeakPick, weakPickOf } from '../../src/gaps/weak-picks';
import { fakeEmbedder, makeProfile, unitVector } from '../fixtures/library';
import { buildTemplate } from '../fixtures/template';

const zero = RationalTime.zero(FrameRates.fps30);

function candidate(fit: number, score = fit): CastCandidate {
  return {
    assetId: newId<'Asset'>(),
    shotId: newId<'Shot'>(),
    sourceStart: zero,
    syncPoint: null,
    score,
    parts: {
      intent: fit,
      motion: 0,
      quality: 0.5,
      subject: 0.5,
      energy: 0.5,
      hook: null,
      rerank: null,
      penalty: 0,
    },
  };
}

function slot(
  pick: CastCandidate,
  alternates: CastCandidate[],
  confidence: number | null,
  note: SlotCast['note'] = null,
): SlotCast {
  return {
    slotId: newId<'TemplateSlot'>(),
    clipId: newId<'TimelineItem'>(),
    pick,
    alternates,
    confidence,
    needsRerank: confidence !== null && confidence < config.confidence.rerankBelow,
    note,
  };
}

describe('weak picks (FIX-GAPS)', () => {
  it('lists the alternates of a pick under the line best fit first, and takes one that clearly fits better', () => {
    const [fair, best, good] = [candidate(0.5, 0.7), candidate(0.9, 0.6), candidate(0.8, 0.55)];
    const weak = weakPickOf(slot(candidate(0.4, 0.72), [fair!, best!, good!], 0.2));
    expect(weak?.confidence).toBe(0.2);
    expect(weak?.pick.fit).toBe(0.4);
    expect(weak?.candidates.map((c) => c.fit)).toEqual([0.9, 0.8, 0.5]);
    expect(weak?.candidates[0]?.shotId).toBe(best!.shotId);
    expect(weak?.better?.shotId).toBe(best!.shotId);
  });

  it('keeps a pick that fits but is unsure only for a close runner-up: no candidate clearly fits better', () => {
    const weak = weakPickOf(slot(candidate(0.8, 0.7), [candidate(0.85, 0.69)], 0.1));
    expect(weak?.candidates).toHaveLength(1);
    expect(weak?.better).toBeNull();
  });

  it('keeps a poor pick when no candidate fits over the line either', () => {
    const weak = weakPickOf(slot(candidate(0.3), [candidate(0.5), candidate(0.2)], 0.0));
    expect(weak?.candidates.map((c) => c.fit)).toEqual([0.5, 0.2]);
    expect(weak?.better).toBeNull();
  });

  it("is not a weak pick when sure, the person's own pick, filled by a gap fix, or a gap", () => {
    expect(weakPickOf(slot(candidate(0.9), [], config.confidence.rerankBelow))).toBeNull();
    expect(isWeakPick(slot(candidate(0.3), [], null, 'userPick'))).toBe(false);
    expect(isWeakPick(slot(candidate(0.3), [], 0.1, 'userPick'))).toBe(false);
    expect(isWeakPick(slot(candidate(0.3), [], 0.1, 'gapFilled'))).toBe(false);
    expect(isWeakPick({ ...slot(candidate(0.3), [], 0.1), clipId: null })).toBe(false);
    expect(isWeakPick(slot(candidate(0.3), [], 0.1, 'filmRequested'))).toBe(true);
  });

  it("reads a real cast's weak slot: its alternates are the swap candidates, and a pick no clip beats stays", async () => {
    const template = buildTemplate({
      slots: [
        { frames: 30, text: 'Frame the traveler from behind on a quiet street at night', motion: 'static' },
      ],
    });
    const table = new Map(template.slots.map((s) => [s.intent.text, unitVector(1)]));
    const described = (profile: ShotProfile, description: string): ShotProfile => ({
      ...profile,
      description,
    });
    const beach = described(
      makeProfile({ embedding: unitVector(9), motionClass: 'static', faceCount: 1 }),
      'A person talks to the camera on a sunny beach.',
    );
    const kitchen = described(
      makeProfile({ embedding: unitVector(7), motionClass: 'static', faceCount: 1 }),
      'A person talks to the camera in a bright kitchen.',
    );
    const engine = createCastingEngine({
      catalog: createMemoryShotCatalog([beach, kitchen]),
      embedder: fakeEmbedder(table),
    });
    const cast = await engine.cast({
      projectId: newId<'Project'>(),
      template,
      mode: 'template',
      variants: 1,
      seed: 1,
    });
    if (!cast.ok) throw new Error(cast.error.code);
    const stored = cast.value.variants[0]!.slots[0]!;
    // The engine leaves clipId to assembly; a placed clip is what the gaps step reads.
    const weak = weakPickOf({ ...stored, clipId: newId<'TimelineItem'>() });
    expect(stored.needsRerank).toBe(true);
    expect(weak).not.toBeNull();
    expect(weak!.candidates.map((c) => c.shotId)).toEqual(stored.alternates.map((a) => a.shotId));
    expect(weak!.candidates.length).toBeGreaterThan(0);
    for (const c of weak!.candidates) expect(c.fit).toBeGreaterThanOrEqual(0);
    expect(weak!.better).toBeNull();
  });
});
