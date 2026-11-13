// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-M2 step 2–3: the score's parts, the hook bonus and the neighbour penalties. */
import { describe, expect, it } from 'vitest';
import { fitsSlot, scoreCandidate } from '../src/casting/candidates';
import { createMemoryShotCatalog, matchesFilter, profileKey } from '../src/casting/catalog';
import { CASTING_CONFIG } from '../src/casting/config';
import {
  adjacencyPenalty,
  hookScore,
  motionMatch,
  novelty,
  shotEnergy,
  subjectMatch,
  unaryParts,
  unaryScore,
} from '../src/casting/score';
import { intentText, orientationOf, slotSpecs, type SlotSpec } from '../src/casting/slots';
import { makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;

function spec(overrides: Partial<SlotSpec> = {}): SlotSpec {
  const template = buildTemplate({ slots: [{ frames: 30 }, { frames: 30 }] });
  return { ...slotSpecs(template, config)[1]!, ...overrides };
}

describe('score parts', () => {
  it('matches motion by class, then family, else zero; neutral when the slot says nothing', () => {
    const shot = makeProfile({ embedding: unitVector(1), motionClass: 'pan' });
    expect(motionMatch(spec({ motion: 'pan' }), shot, config)).toBe(1);
    expect(motionMatch(spec({ motion: 'tilt' }), shot, config)).toBe(0.5);
    expect(motionMatch(spec({ motion: 'push-in' }), shot, config)).toBe(0);
    expect(motionMatch(spec({ motion: null }), shot, config)).toBe(config.neutral.motion);
    expect(motionMatch(spec({ motion: 'static' }), makeProfile({ embedding: unitVector(1), kind: 'image' }), config)).toBe(1);
  });

  it('compares people with faces and the subject with object tags', () => {
    const crowd = makeProfile({ embedding: unitVector(2), faceCount: 2, tags: ['Dog'] });
    const empty = makeProfile({ embedding: unitVector(2), faceCount: 0 });
    expect(subjectMatch(spec({ people: null }), crowd, config)).toBe(0.5);
    expect(subjectMatch(spec({ people: 0 }), empty, config)).toBe(1);
    expect(subjectMatch(spec({ people: 0 }), crowd, config)).toBe(config.subject.facesWhenNoneWanted);
    expect(subjectMatch(spec({ people: 4 }), crowd, config)).toBe(0.5);
    expect(subjectMatch(spec({ people: 1 }), empty, config)).toBe(0);
    expect(subjectMatch(spec({ people: 2, subject: 'dog' }), crowd, config)).toBe(1);
    expect(subjectMatch(spec({ people: 2, subject: 'cat' }), crowd, config)).toBe(0.5);
  });

  it('uses a measured energy, else the motion class energy', () => {
    expect(shotEnergy(makeProfile({ embedding: unitVector(3), energy: 0.9 }), config)).toBe(0.9);
    expect(shotEnergy(makeProfile({ embedding: unitVector(3), motionClass: 'tracking' }), config)).toBe(0.85);
    expect(shotEnergy(makeProfile({ embedding: unitVector(3), motionClass: null }), config)).toBe(0.15);
  });

  it('weighs the parts by the config and adds the hook bonus on slot 0 only', () => {
    const shot = makeProfile({ embedding: unitVector(4), motionClass: 'pan', quality: 0.7, faceCount: 1 });
    // FIX-CAST: the cosine is rescaled from the config's floor (0.6) to its ceiling (0.78): 0.69 is halfway.
    const parts = unaryParts(spec({ motion: 'pan', energy: 0.45 }), shot, 0.69, { config, recent: [], hook: false });
    expect(parts).toEqual({ intent: expect.closeTo(0.5, 12), motion: 1, quality: 0.7, subject: 0.5, energy: 1, hook: null });
    expect(unaryScore(parts, config)).toBeCloseTo(0.4 * 0.5 + 0.15 + 0.15 * 0.7 + 0.15 * 0.5 + 0.15, 12);
    expect(unaryParts(spec(), shot, -0.4, { config, recent: [], hook: false }).intent).toBe(0);
    expect(unaryParts(spec(), shot, null, { config, recent: [], hook: false }).intent).toBe(config.neutral.intent);
    const hooked = unaryParts(spec(), shot, 0.8, { config, recent: [], hook: true });
    expect(unaryScore(hooked, config) - unaryScore({ ...hooked, hook: null }, config)).toBeCloseTo(0.2 * hooked.hook!, 12);
  });

  it('scores the hook on motion energy, a face, novelty and sharpness', () => {
    const shot = makeProfile({ embedding: unitVector(5), motionClass: 'handheld', faceCount: 1, sharpness: 1 });
    expect(hookScore(shot, [], config)).toBeCloseTo(0.35 * 0.75 + 0.25 + 0.25 + 0.15, 12);
    expect(novelty(shot, [shot.embedding])).toBe(1);
    expect(novelty(shot, [Float32Array.from(shot.embedding)])).toBeCloseTo(0, 6);
  });

  it('penalises near duplicates, the same file and the same place between neighbours', () => {
    const a = makeProfile({ embedding: unitVector(6), place: 'beach' });
    const twin = makeProfile({ embedding: unitVector(6), place: 'beach', assetId: a.assetId });
    const other = makeProfile({ embedding: unitVector(7), place: null });
    expect(adjacencyPenalty(a, twin, config)).toBeCloseTo(0.35 + 0.5 + 0.2, 12);
    expect(adjacencyPenalty(a, other, config)).toBe(0);
    // Two shots with no place don't count as the same place.
    expect(adjacencyPenalty(other, makeProfile({ embedding: unitVector(11), place: null }), config)).toBe(0);
  });
});

describe('hard filters', () => {
  it('keep orientation, quality, length, capture time, sources and exclusions', () => {
    const shot = makeProfile({ embedding: unitVector(8), frames: 40, quality: 0.5, capturedAt: 1000 });
    expect(matchesFilter(shot, { orientations: ['landscape'] })).toBe(false);
    expect(matchesFilter(shot, { minQuality: 0.6 })).toBe(false);
    expect(matchesFilter(shot, { minDuration: spec({}).consumes })).toBe(true);
    expect(matchesFilter(shot, { capturedFrom: 2000 })).toBe(false);
    expect(matchesFilter(shot, { capturedTo: 500 })).toBe(false);
    expect(matchesFilter(shot, { sourceIds: [] })).toBe(false);
    expect(matchesFilter(shot, { exclude: new Set([profileKey(shot)]) })).toBe(false);
    expect(fitsSlot(makeProfile({ embedding: unitVector(8), frames: 29 }), spec())).toBe(false);
  });

  it('describes slots: orientation from the canvas, intent words, energy raised by beat density', () => {
    expect(orientationOf({ width: 1080, height: 1920 })).toBe('portrait');
    expect(orientationOf({ width: 1920, height: 1080 })).toBe('landscape');
    expect(orientationOf({ width: 100, height: 100 })).toBe('square');
    const busy = buildTemplate({ slots: [{ frames: 30, energy: 0.5 }], beatEvery: 5 });
    expect(slotSpecs(busy, config)[0]!.energy).toBeCloseTo(0.5 + (6 - 2) * 0.1, 12);
    const pending = buildTemplate({ slots: [{ frames: 30, pending: true, motion: 'pan' }] });
    expect(intentText(pending.slots[0]!)).toBe('pan');
    expect(intentText(buildTemplate({ slots: [{ frames: 30, pending: true }] }).slots[0]!)).toBeNull();
  });

  it('scores a candidate once with its key', async () => {
    const shot = makeProfile({ embedding: unitVector(9) });
    const candidate = scoreCandidate(spec(), shot, 0.5, { config, recent: [] }, 0.25);
    expect(candidate.key).toBe(profileKey(shot));
    expect(candidate.unary).toBeCloseTo(unaryScore(candidate.parts, config) + 0.25, 12);
    const catalog = createMemoryShotCatalog([shot]);
    const recent = await catalog.recent(3);
    expect(recent.ok && recent.value).toEqual([shot.embedding]);
  });
});
