// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-M2: the beam, adjacency, alternates and confidence, relaxed orientation, gaps, rerank, locks. */
import { newId, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { beamSearch, sequenceScore } from '../src/casting/beam';
import { scoreCandidate, type Candidate, type SlotPool } from '../src/casting/candidates';
import { createMemoryShotCatalog, profileKey } from '../src/casting/catalog';
import { CASTING_CONFIG } from '../src/casting/config';
import { createCastingEngine } from '../src/casting/engine';
import { adjacencyPenalty } from '../src/casting/score';
import { slotSpecs } from '../src/casting/slots';
import { candidateKey } from '../src/model/cast';
import { world } from './fixtures/casting';
import { fakeEmbedder, makeProfile, random, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;
const projectId = newId<'Project'>();
const adjacency = (a: Candidate, b: Candidate) => adjacencyPenalty(a.profile, b.profile, config);

function bruteForce(pools: readonly SlotPool[]): number {
  let best = Number.NEGATIVE_INFINITY;
  const walk = (slot: number, picks: Candidate[]) => {
    if (slot === pools.length) {
      best = Math.max(best, sequenceScore(picks, adjacency));
      return;
    }
    for (const candidate of pools[slot]!.candidates) {
      if (picks.some((pick) => pick.key === candidate.key)) continue;
      walk(slot + 1, [...picks, candidate]);
    }
  };
  walk(0, []);
  return best;
}

describe('beam search', () => {
  it('matches brute force where width 8 keeps every state', () => {
    const template = buildTemplate({ slots: [{ frames: 30 }, { frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const specs = slotSpecs(template, config);
    for (let seed = 1; seed <= 20; seed++) {
      const next = random(seed);
      const shared = Array.from({ length: 3 }, (_, index) =>
        makeProfile({ embedding: unitVector(seed * 50 + index), place: next() > 0.5 ? 'beach' : null, quality: next() }),
      );
      const pools: SlotPool[] = specs.map((slot) => {
        const pair = [shared[Math.floor(next() * 3)]!, shared[Math.floor(next() * 3)]!].filter(
          (profile, index, list) => list.indexOf(profile) === index,
        );
        const candidates = pair.map((profile) => scoreCandidate(slot, profile, next(), { config, recent: [] }));
        return { slot, candidates, locked: false, relaxed: false, reranked: false };
      });
      const [best] = beamSearch(pools, { width: 8, tie: config.tieEpsilon, adjacency });
      const brute = bruteForce(pools);
      if (brute === Number.NEGATIVE_INFINITY) continue;
      if (best!.picks.every((pick) => pick)) expect(best!.score).toBeCloseTo(brute, 9);
    }
  });

  it('never puts two near duplicates back to back when a distinct shot is close', () => {
    const template = buildTemplate({ slots: [{ frames: 30, text: 'a' }, { frames: 30, text: 'b' }] });
    const intent = unitVector(9);
    const twin = makeProfile({ embedding: intent, motionClass: null });
    const copy = makeProfile({ embedding: intent, motionClass: null, assetId: twin.assetId });
    const other = makeProfile({ embedding: unitVector(10), motionClass: null });
    const engine = createCastingEngine({
      catalog: createMemoryShotCatalog([twin, copy, other]),
      embedder: fakeEmbedder(new Map([['slot 0', intent], ['slot 1', intent], ['a', intent], ['b', intent]])),
    });
    return engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 }).then((result) => {
      if (!result.ok) throw new Error(result.error.code);
      const picks = result.value.variants[0]!.slots.map((slot) => slot.pick && candidateKey(slot.pick));
      expect(picks).toContain(profileKey(other));
      expect(new Set(picks).size).toBe(2);
    });
  });
});

describe('the engine', () => {
  it('gives three alternates per slot, scored with the chosen neighbours, and a confidence from the margin', async () => {
    const { template, engine } = world({ slots: 4, perSlot: 5, distractors: 20, seed: 21 });
    const result = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 });
    if (!result.ok) throw new Error(result.error.code);
    const [variant] = result.value.variants;
    const used = new Set(variant!.slots.map((slot) => slot.pick && candidateKey(slot.pick)));
    for (const slot of variant!.slots) {
      expect(slot.alternates).toHaveLength(3);
      for (const alternate of slot.alternates) expect(used.has(candidateKey(alternate))).toBe(false);
      const margin = Math.max(0, slot.pick!.score - slot.alternates[0]!.score);
      expect(slot.confidence).toBeCloseTo(margin / (margin + config.confidence.tau), 9);
      expect(slot.needsRerank).toBe(slot.confidence! < config.confidence.rerankBelow);
      expect(slot.alternates[0]!.score).toBeLessThanOrEqual(slot.pick!.score + config.tieEpsilon);
    }
    expect(result.value.configVersion).toBe('casting.v5');
    expect(variant!.sequenceConfidence).toBeGreaterThan(0);
  });

  it('is deterministic for one library state', async () => {
    const { template, engine } = world({ slots: 6, perSlot: 4, distractors: 30, seed: 8 });
    const one = await engine.cast({ projectId, template, mode: 'template', variants: 3, seed: 1 });
    const two = await engine.cast({ projectId, template, mode: 'template', variants: 3, seed: 1 });
    if (!one.ok || !two.ok) throw new Error('cast failed');
    expect({ ...one.value, castId: null }).toEqual({ ...two.value, castId: null });
  });

  it('relaxes orientation for an empty slot, then leaves a gap, and never reuses a shot', async () => {
    const template = buildTemplate({ slots: [{ frames: 30, text: 'wide' }, { frames: 30, text: 'wide' }, { frames: 30, text: 'wide' }] });
    const landscape = makeProfile({ embedding: unitVector(4), orientation: 'landscape' });
    const engine = createCastingEngine({ catalog: createMemoryShotCatalog([landscape]), embedder: fakeEmbedder(new Map()) });
    // A canvas the request names (a person's choice) keeps its orientation, so the other one is relaxed (BRK1-MAKE).
    const canvas = { width: template.canvas.width, height: template.canvas.height };
    const result = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1, canvas });
    if (!result.ok) throw new Error(result.error.code);
    const [first, second, third] = result.value.variants[0]!.slots;
    expect(first?.note).toBe('orientationRelaxed');
    expect(first?.confidence).toBeLessThanOrEqual(config.candidates.relaxedConfidenceCap);
    expect([second?.pick, third?.pick]).toEqual([null, null]);
    expect(second?.note).toBe('noCandidates');
  });

  it('answers timeline.no_candidates when nothing can fill any slot', async () => {
    const template = buildTemplate({ slots: [{ frames: 30 }] });
    const short = makeProfile({ embedding: unitVector(1), frames: 10 });
    const engine = createCastingEngine({ catalog: createMemoryShotCatalog([short]), embedder: fakeEmbedder(new Map()) });
    const result = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 });
    expect(!result.ok && result.error.code).toBe('timeline.no_candidates');
  });

  it('keeps a rerank inside the five it ordered and marks the slot', async () => {
    const { template, engine, profiles } = world({ slots: 2, perSlot: 6, distractors: 10, seed: 4 });
    const first = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 });
    if (!first.ok) throw new Error(first.error.code);
    const slot = first.value.variants[0]!.slots[0]!;
    const five = [slot.pick!, ...slot.alternates].map((candidate) => candidate.shotId!);
    const outsider = profiles.find((profile) => !five.includes(profile.shotId!))!;
    const order = [five[3]!, five[0]!, five[1]!, five[2]!, outsider.shotId!];
    const reranked = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1, rerank: [{ slotId: slot.slotId, order }] });
    if (!reranked.ok) throw new Error(reranked.error.code);
    const after = reranked.value.variants[0]!.slots[0]!;
    expect(after.note).toBe('reranked');
    expect(order).toContain(after.pick!.shotId);
    for (const alternate of after.alternates) expect(order).toContain(alternate.shotId);
    expect(after.pick!.parts.rerank).not.toBeNull();
  });

  it('keeps a locked slot and its in-point, and no other slot uses that shot', async () => {
    const { template, engine, profiles } = world({ slots: 3, perSlot: 3, distractors: 5, seed: 6 });
    const locked = profiles[0]!;
    const sourceStart = RationalTime.of(12, locked.range.start.rate);
    const result = await engine.cast({
      projectId,
      template,
      mode: 'template',
      variants: 2,
      seed: 1,
      locked: [{ slotId: template.slots[1]!.id, assetId: locked.assetId, shotId: locked.shotId, sourceStart }],
    });
    if (!result.ok) throw new Error(result.error.code);
    for (const variant of result.value.variants) {
      const [a, b, c] = variant.slots;
      expect(b?.pick?.shotId).toBe(locked.shotId);
      expect(b?.pick?.sourceStart).toEqual(sourceStart);
      expect(b?.note).toBe('userPick');
      expect([a?.pick?.shotId, c?.pick?.shotId]).not.toContain(locked.shotId);
    }
  });

  it('suggests alternates for one slot given its neighbours', async () => {
    const { template, engine } = world({ slots: 3, perSlot: 4, distractors: 10, seed: 12 });
    const cast = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 });
    if (!cast.ok) throw new Error(cast.error.code);
    const [a, b, c] = cast.value.variants[0]!.slots;
    const found = await engine.alternates({
      template,
      slotId: b!.slotId,
      previous: a!.pick,
      next: c!.pick,
      used: [a, b, c].map((slot) => candidateKey(slot!.pick!)),
      exclude: [],
      limit: 4,
    });
    if (!found.ok) throw new Error(found.error.code);
    expect(found.value).toHaveLength(4);
    expect(found.value.map((candidate) => candidate.shotId)).not.toContain(b!.pick!.shotId);
    const scores = found.value.map((candidate) => candidate.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });
});
