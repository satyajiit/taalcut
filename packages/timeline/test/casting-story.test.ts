// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-STORY through the casting engine, on made-up libraries whose cosines are set exactly: a slot that names a
 * thing few shots show casts the shot that shows it, even where the search used to trade it away; words every shot
 * shares change nothing; a chat over a slot asks for someone on a phone; and in a library with no spare shot the
 * rerank offers the other slots' picks, and putting one first swaps the two slots.
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  ok,
  type GRAPHIC_BRIEF_KINDS,
  type ShotId,
  type ShotProfile,
  type SlotId,
  type Template,
  type TextOverlay,
} from '@taalcut/core';

type GraphicBriefKind = (typeof GRAPHIC_BRIEF_KINDS)[number];
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { CASTING_CONFIG, type CastingConfig } from '../src/casting/config';
import { createCastingEngine, type CastResult } from '../src/casting/engine';
import { rerankMaterial } from '../src/tools/rerank-material';
import { castToolOutputSchema } from '../src/tools/schemas';
import { DIMS, fakeEmbedder, makeProfile, normalise } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const projectId = newId<'Project'>();

/** A unit vector with these cosines to the first axes (the slots' intents), the rest on its own axis. */
function vector(cosines: readonly number[], own: number): Float32Array {
  const out = new Float32Array(DIMS);
  cosines.forEach((value, axis) => (out[axis] = value));
  out[own] = Math.sqrt(Math.max(0, 1 - cosines.reduce((sum, value) => sum + value * value, 0)));
  return normalise(out);
}

const axis = (index: number) => vector([...Array.from({ length: index }, () => 0), 1], DIMS - 1);

function engineFor(
  template: Template,
  profiles: readonly ShotProfile[],
  config: CastingConfig = CASTING_CONFIG,
) {
  const table = new Map(template.slots.map((slot, index) => [slot.intent.text, axis(index)]));
  return createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
    config,
  });
}

/** The config before FIX-STORY: no word counts, and the hook has no story part. */
const WORDS_OFF: CastingConfig = {
  ...CASTING_CONFIG,
  version: 'casting.v99',
  terms: { ...CASTING_CONFIG.terms, weight: 0 },
  hook: { ...CASTING_CONFIG.hook, story: 0 },
};

async function castOf(
  engine: ReturnType<typeof engineFor>,
  template: Template,
  extra: object = {},
): Promise<CastResult> {
  const result = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1, ...extra });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const picks = (result: CastResult) => result.variants[0]!.slots.map((slot) => slot.pick?.shotId ?? null);

/** Two slots, two shots: the phone shot fits the second slot a little better, the other the first. */
function phoneWorld() {
  const template = buildTemplate({
    slots: [
      { frames: 30, text: 'Someone reads a phone by the fence' },
      { frames: 30, text: 'A quiet moment by the fence' },
    ],
  });
  const phone = makeProfile({
    embedding: vector([0.7, 0.7], 2),
    description: 'A cyclist leans on a fence and reads a phone',
    tags: ['cyclist', 'phone', 'fence'],
  });
  const other = makeProfile({
    embedding: vector([0.72, 0.66], 3),
    description: 'A cyclist leans on a fence beside a map',
    tags: ['cyclist', 'fence', 'map'],
  });
  return { template, phone, other, profiles: [phone, other] };
}

describe('FIX-STORY: what a slot names', () => {
  it('casts the shot that shows the rare thing the opening names, where the search used to trade it away', async () => {
    const { template, phone, other, profiles } = phoneWorld();
    const before = await castOf(engineFor(template, profiles, WORDS_OFF), template);
    expect(picks(before)).toEqual([other.shotId, phone.shotId]);
    const after = await castOf(engineFor(template, profiles), template);
    expect(picks(after)).toEqual([phone.shotId, other.shotId]);
    const opening = after.variants[0]!.slots[0]!.pick!;
    expect(after.configVersion).toBe('casting.v5');
    // The phone counts on the intent part and, on the opening, on the hook.
    expect(opening.parts.intent).toBeGreaterThan(before.variants[0]!.slots[0]!.pick!.parts.intent);
    expect(opening.parts.hook).toBeGreaterThanOrEqual(CASTING_CONFIG.hook.story);
  });

  it('counts a word only for the shots that show it, and not at all when every shot shows it', async () => {
    const template = buildTemplate({ slots: [{ frames: 30, text: 'Someone walking down the street' }] });
    const profiles = [0.7, 0.68, 0.66].map((cosine, index) =>
      makeProfile({
        embedding: vector([cosine], 2 + index),
        description: `A person walking down a street, take ${index}`,
        tags: ['person', 'street'],
      }),
    );
    const on = await castOf(engineFor(template, profiles), template);
    const off = await castOf(engineFor(template, profiles, WORDS_OFF), template);
    const parts = (result: CastResult) => {
      const slot = result.variants[0]!.slots[0]!;
      return [slot.pick!, ...slot.alternates].map((candidate) => [
        candidate.shotId,
        candidate.parts.intent,
        candidate.score,
      ]);
    };
    expect(parts(on)).toEqual(parts(off));
  });

  it('lets a word few shots share lift those shots a little, and a word one shot shows lift it most', async () => {
    const template = buildTemplate({ slots: [{ frames: 30, text: 'A dog on the beach' }] });
    const shot = (index: number, tags: string[]) =>
      makeProfile({ embedding: vector([0.7], 2 + index), description: `Shot ${index}`, tags });
    const profiles = [shot(0, ['dog', 'beach']), shot(1, ['beach']), shot(2, ['beach']), shot(3, ['sand'])];
    const result = await castOf(engineFor(template, profiles), template);
    const slot = result.variants[0]!.slots[0]!;
    const intent = new Map([slot.pick!, ...slot.alternates].map((c) => [c.shotId, c.parts.intent]));
    expect(slot.pick!.shotId).toBe(profiles[0]!.shotId);
    const [dog, beach, , sand] = profiles.map((profile) => intent.get(profile.shotId)!);
    expect(dog! - beach!).toBeGreaterThan(beach! - sand!);
    expect(beach!).toBeGreaterThan(sand!);
  });
});

/** A reading that calls the overlay a graphic of `kind` (DSG1-READ's brief, which casting reads). */
const readingOf = (overlayId: TextOverlay['id'], kind: GraphicBriefKind) => ({
  version: 1 as const,
  prompt: 'graphic-brief/1',
  model: null,
  briefs: [
    {
      overlayId,
      graphic: true,
      reason: null,
      kind,
      what: 'a made-up graphic',
      role: 'other' as const,
      answers: null,
      look: { words: '', platform: 'neutral' as const, shadow: false, avatar: false },
      motion: { words: '', typingSeconds: null },
      timing: { cue: 'free' as const, words: '' },
      people: { words: '' },
      source: 'model' as const,
      confidence: 0.8,
    },
  ],
  system: {
    tokens: { platform: 'neutral' as const, fills: [], text: [], cornerRadius: null, font: null },
    conversation: [],
    stack: null,
    words: '',
  },
});

describe('FIX-STORY: what a slot’s graphics need (FIX-HOOK: nothing, by themselves)', () => {
  function world(kind: GraphicBriefKind | null) {
    const built = buildTemplate({
      slots: [{ frames: 30, text: 'A commuter waits at the tram stop' }],
      overlays: [{ start: 3, frames: 20, text: 'Made-up message', slot: 0 }],
    });
    const template: Template = kind
      ? { ...built, graphics: { uses: [], reading: readingOf(built.text[0]!.id, kind) } }
      : built;
    const phone = makeProfile({
      embedding: vector([0.68], 2),
      description: 'Someone sits on a bench',
      tags: ['phone', 'bench'],
    });
    const other = makeProfile({
      embedding: vector([0.7], 3),
      description: 'Someone sits on a bench',
      tags: ['bag', 'bench'],
    });
    return { template, phone, other, profiles: [phone, other] };
  }

  it('FIX-HOOK: no longer asks the footage for a phone by itself, whatever graphic is over the slot', async () => {
    // What the footage under a graphic must show is the slot's needs, which the Analyst states (casting-needs.test.ts).
    for (const role of ['incomingMessage', 'outgoingMessage', 'title', null] as const) {
      const { template, profiles, other } = world(role);
      const result = await castOf(engineFor(template, profiles), template);
      expect(picks(result)[0], String(role)).toBe(other.shotId);
    }
  });
});

describe('FIX-STORY: a rerank in a library with no spare shot', () => {
  /** Two slots, two shots, no spare: the opening's pick fits it poorly, the other slot's would fit it better. */
  function noSpares() {
    const template = buildTemplate({
      slots: [
        { frames: 30, text: 'First made-up line' },
        { frames: 30, text: 'Second made-up line' },
      ],
    });
    const poor = makeProfile({ embedding: vector([0.64, 0.6], 2), description: 'A made-up shot of a gate' });
    const good = makeProfile({
      embedding: vector([0.68, 0.72], 3),
      description: 'A made-up shot of a tower',
    });
    return { template, poor, good, profiles: [poor, good] };
  }
  const describeShots = (profiles: readonly ShotProfile[]) => async (ids: readonly ShotId[]) =>
    ok(
      new Map(
        profiles.filter((p) => ids.includes(p.shotId!)).map((p) => [p.shotId as string, p.description ?? '']),
      ),
    );

  it('lists the other slot’s pick with the slot it would leave, and putting it first swaps the two slots', async () => {
    const { template, poor, good, profiles } = noSpares();
    const engine = engineFor(template, profiles);
    const cast = await castOf(engine, template);
    expect(picks(cast)).toEqual([poor.shotId, good.shotId]);
    const [opening, second] = cast.variants[0]!.slots;
    expect(opening!.needsRerank).toBe(true);
    expect(opening!.alternates).toEqual([]);

    const material = await rerankMaterial(cast, template, describeShots(profiles), {
      count: CASTING_CONFIG.rerank.count,
    });
    expect(material.map((slot) => slot.slotId)).toEqual([opening!.slotId]);
    expect(material[0]!.candidates).toEqual([
      { shotId: poor.shotId, description: poor.description },
      {
        shotId: good.shotId,
        description: good.description,
        from: { slotId: second!.slotId, intent: 'Second made-up line' },
      },
    ]);

    expect(castToolOutputSchema.shape.rerank.safeParse(material).success).toBe(true);
    // The Librarian puts the other slot's shot first.
    const order = [good.shotId as ShotId, poor.shotId as ShotId];
    const swapped = await castOf(engine, template, {
      rerank: [{ slotId: opening!.slotId as SlotId, order }],
    });
    const [first, other] = swapped.variants[0]!.slots;
    expect(picks(swapped)).toEqual([good.shotId, poor.shotId]);
    expect([first!.note, other!.note]).toEqual(['reranked', 'reranked']);
    expect(first!.pick!.parts.rerank).not.toBeNull();
    // Each slot's confidence is its new pick's: the opening fits better than it did, the other slot worse.
    expect(first!.pick!.parts.intent).toBeGreaterThan(opening!.pick!.parts.intent);
    expect(other!.confidence).toBeLessThan(second!.confidence!);
    expect(other!.needsRerank).toBe(true);
  });

  it('keeps an order inside its slot’s own shots when its first shot is the slot’s own pick', async () => {
    const { template, poor, good, profiles } = noSpares();
    const engine = engineFor(template, profiles);
    const cast = await castOf(engine, template);
    const slotId = cast.variants[0]!.slots[0]!.slotId as SlotId;
    const kept = await castOf(engine, template, {
      rerank: [{ slotId, order: [poor.shotId as ShotId, good.shotId as ShotId] }],
    });
    expect(picks(kept)).toEqual([poor.shotId, good.shotId]);
    expect(kept.variants[0]!.slots.map((slot) => slot.note)).toEqual(['reranked', null]);
  });

  it('relaxes orientation in story mode when strict-orientation shots are fewer than the slots', async () => {
    const template = buildTemplate({
      slots: [
        { frames: 30, text: 'Wide shot of the new ground floor living room' },
        { frames: 30, text: 'First floor construction progress' },
      ],
    });
    const landscapeOne = makeProfile({
      orientation: 'landscape',
      embedding: vector([0.8, 0.4], 2),
      description: 'Wide ground floor interior of our first own house',
    });
    const landscapeTwo = makeProfile({
      orientation: 'landscape',
      embedding: vector([0.4, 0.8], 3),
      description: 'First floor concrete slab under construction',
    });
    const engine = engineFor(template, [landscapeOne, landscapeTwo]);
    const cast = await castOf(engine, template, { mode: 'story' });
    expect(picks(cast)).toEqual([landscapeOne.shotId, landscapeTwo.shotId]);
  });
});
