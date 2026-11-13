// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-HOOK through the casting engine, on made-up libraries whose cosines are set exactly. A slot's needs (what the
 * Analyst says its footage must show) go to a shot that meets them, by the things its description names or by meaning,
 * even where the intent's other words (night) favour another shot and the search would trade it to a slot it fits
 * better. A need no shot meets changes nothing, and the intent's `face` decides whether a window may show a face.
 */
import { describe, expect, it } from 'vitest';
import { err, newId, type ShotProfile, type SlotIntent, type Template } from '@taalcut/core';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { CASTING_CONFIG, type CastingConfig } from '../src/casting/config';
import { createCastingEngine, type CastResult } from '../src/casting/engine';
import { slotNeeds } from '../src/casting/needs';
import { slotSpecs } from '../src/casting/slots';
import { slotWants } from '../src/casting/subject-terms';
import { DIMS, fakeEmbedder, makeProfile, normalise } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const projectId = newId<'Project'>();
const NEED_AXIS = 5;

/** A unit vector with these cosines to the first axes, the rest on its own axis. */
function vector(cosines: readonly number[], own: number): Float32Array {
  const out = new Float32Array(DIMS);
  cosines.forEach((value, axis) => (out[axis] = value));
  out[own] = Math.sqrt(Math.max(0, 1 - cosines.reduce((sum, value) => sum + value * value, 0)));
  return normalise(out);
}

const axis = (index: number) => vector([...Array.from({ length: index }, () => 0), 1], DIMS - 1);

/** The config without FIX-HOOK's cost: casting.v4's behaviour. */
const NEEDS_OFF: CastingConfig = {
  ...CASTING_CONFIG,
  version: 'casting.v99',
  terms: { ...CASTING_CONFIG.terms, requiredPenalty: 0 },
};

const withIntent = (template: Template, index: number, change: Partial<SlotIntent>): Template => ({
  ...template,
  slots: template.slots.map((slot, at) =>
    at === index ? { ...slot, intent: { ...slot.intent, ...change } } : slot,
  ),
});

/**
 * Two slots and two shots, no spare. The opening, at a bus stop at night, needs `needs`. The night shot is closer to
 * its line and says night; the bench shot is a day shot that suits the second slot (a fountain by day) far better, so
 * the search's best sum trades it there. The bench shot names a letter (`named`), sits near the need by meaning only
 * (`meaning`), or neither (`none`).
 */
function world(needs: readonly string[] | undefined, bench: 'named' | 'meaning' | 'none') {
  const built = buildTemplate({
    slots: [
      { frames: 30, text: 'Someone waits at a bus stop at night' },
      { frames: 30, text: 'Someone stands by a fountain by day' },
    ],
  });
  const template = needs ? withIntent(built, 0, { needs: [...needs] }) : built;
  const night = makeProfile({
    embedding: vector([0.76, 0.5], 2),
    description: 'A person walks along a road at night',
    tags: ['person', 'road'],
  });
  const benchShot = makeProfile({
    embedding: bench === 'meaning' ? vector([0.7, 0.62, 0, 0, 0, 0.3], 3) : vector([0.7, 0.74], 3),
    description:
      bench === 'named'
        ? 'A person sits on a park bench reading a letter by day'
        : 'A person sits on a park bench by day',
    tags: bench === 'named' ? ['person', 'letter', 'bench'] : ['person', 'bench'],
  });
  return { template, night, bench: benchShot, profiles: [night, benchShot] };
}

function engineFor(
  template: Template,
  profiles: readonly ShotProfile[],
  config: CastingConfig = CASTING_CONFIG,
) {
  const table = new Map(template.slots.map((slot, index) => [slot.intent.text, axis(index)]));
  for (const slot of template.slots)
    for (const need of slot.intent.needs ?? []) table.set(need, axis(NEED_AXIS));
  return createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
    config,
  });
}

async function castOf(template: Template, profiles: readonly ShotProfile[], config?: CastingConfig) {
  const result = await engineFor(template, profiles, config).cast({
    projectId,
    template,
    mode: 'template',
    variants: 1,
    seed: 1,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const picks = (result: CastResult) => result.variants[0]!.slots.map((slot) => slot.pick?.shotId ?? null);
const scores = (result: CastResult) => result.variants[0]!.slots.map((slot) => slot.pick?.score ?? null);

describe('FIX-HOOK: what a slot needs its footage to show', () => {
  it('casts the shot whose description names the need, where night words and the search’s trade placed another', async () => {
    const { template, night, bench, profiles } = world(['someone reading a letter'], 'named');
    const before = await castOf(template, profiles, NEEDS_OFF);
    expect(picks(before)).toEqual([night.shotId, bench.shotId]);
    const after = await castOf(template, profiles);
    expect(picks(after)).toEqual([bench.shotId, night.shotId]);
    expect(after.configVersion).toBe('casting.v5');
    // A day shot under a night line: it wins despite the conflict, which it still pays.
    expect(after.variants[0]!.slots[0]!.pick!.parts.intent).toBeLessThan(
      before.variants[0]!.slots[0]!.pick!.parts.intent,
    );
  });

  it('meets a need by meaning when the description doesn’t name it (a synonym)', async () => {
    const { template, night, bench, profiles } = world(['a handwritten note'], 'meaning');
    expect(picks(await castOf(template, profiles, NEEDS_OFF))).toEqual([night.shotId, bench.shotId]);
    expect(picks(await castOf(template, profiles))).toEqual([bench.shotId, night.shotId]);
  });

  it('casts as before when no shot meets the need, or the slot needs nothing', async () => {
    for (const [needs, bench] of [
      [['someone reading a letter'], 'none'],
      [undefined, 'named'],
      [[], 'named'],
    ] as const) {
      const { template, profiles } = world(needs, bench);
      const on = await castOf(template, profiles);
      const off = await castOf(template, profiles, NEEDS_OFF);
      expect(picks(on), String(needs)).toEqual(picks(off));
      expect(scores(on), String(needs)).toEqual(scores(off));
    }
  });

  it('ranks the shot that meets the need first among a slot’s alternates', async () => {
    const { template, bench, profiles } = world(['someone reading a letter'], 'named');
    const alternates = await engineFor(template, profiles).alternates({
      template,
      slotId: template.slots[0]!.id,
      previous: null,
      next: null,
      used: [],
      exclude: [],
      limit: 5,
    });
    expect(alternates.ok && alternates.value[0]?.shotId).toBe(bench.shotId);
    const unavailableEmbedder = {
      ...fakeEmbedder(new Map()),
      embedTexts: async () =>
        err({
          code: 'vision.embedder_unavailable',
          messageKey: 'errors.vision.embedder_unavailable',
          retryable: false,
        }),
    };
    const lexicalAlternates = await createCastingEngine({
      catalog: createMemoryShotCatalog(profiles),
      embedder: unavailableEmbedder,
    }).alternates({
      template,
      slotId: template.slots[0]!.id,
      previous: null,
      next: null,
      used: [],
      exclude: [],
      limit: 5,
    });
    expect(lexicalAlternates.ok && lexicalAlternates.value[0]?.shotId).toBe(bench.shotId);
  });

  it('reads a slot’s needs from its intent, trimmed and once each, and none from an unwritten one', () => {
    const intent = buildTemplate({ slots: [{ frames: 30, text: 'Someone waits' }] }).slots[0]!.intent;
    const needs = slotNeeds({ ...intent, needs: [' a red kite ', 'a red kite', 'someone running'] });
    expect(needs.map((need) => need.text)).toEqual(['a red kite', 'someone running']);
    expect(needs[0]!.stems).toEqual(['kit']);
    expect(slotNeeds({ ...intent, source: 'pending', needs: ['a red kite'] })).toEqual([]);
  });
});

describe('FIX-HOOK: whether a slot shows the face', () => {
  const settings = CASTING_CONFIG.inPoint.subjects;
  const wants = (text: string, face: SlotIntent['face']) => {
    const template = withIntent(
      buildTemplate({ slots: [{ frames: 30, text }] }),
      0,
      face === undefined ? {} : { face },
    );
    return slotWants(slotSpecs(template, CASTING_CONFIG)[0]!, template, settings).noFace;
  };

  it('keeps a face out when the intent says the reel hides it, and allows one when it says the reel shows it', () => {
    expect(wants('A person waves at the camera', 'hidden')).toBe(true);
    expect(wants('A person walks away from the camera', 'shown')).toBe(false);
  });

  it('falls back on the reel’s subjects and the line when the intent doesn’t say', () => {
    expect(wants('A person walks away from the camera', null)).toBe(true);
    expect(wants('A person waves at the camera', undefined)).toBe(false);
  });
});
