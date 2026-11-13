// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-TPL: fitting templates to a pool of footage. */
import { err, fitTemplatesInputSchema, newId, ValidationError, type TemplateId } from '@taalcut/core';
import { slotIntentText } from '@taalcut/templates';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../../src/casting/config';
import { intentText, slotSpecs } from '../../src/casting/slots';
import { templatePools } from '../../src/casting/template-pools';
import { profileKey } from '../../src/casting/catalog';
import { cosinesTo, packPool } from '../../src/fit/cosines';
import { createTemplateFitter } from '../../src/fit/fit-templates';
import { slotCandidates } from '../../src/fit/slot-candidates';
import { DIMS } from '../fixtures/library';
import { direction, embedder, fitWorld, nth, shot, themed, type Theme } from './fit-world';

const input = (extra: Record<string, unknown> = {}) =>
  fitTemplatesInputSchema.parse({ pool: { capturedFrom: 0 }, ...extra });

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};

const beachPool = (count: number) => Array.from({ length: count }, (_, n) => shot('beach', n + 1));

/** A fit's mean casting score; a test fails here when it has none. */
function meanOf(fit: { readonly meanScore: number | null }): number {
  if (fit.meanScore === null) throw new Error('no mean score');
  return fit.meanScore;
}

describe('fit: ranking', () => {
  it('puts the template the footage matches first, then by mean score, the same every time', async () => {
    const beach = themed(['beach', 'beach', 'beach']);
    const market = themed(['market', 'market', 'market']);
    const coffee = themed(['coffee', 'coffee', 'coffee']);
    const { fitter } = await fitWorld(
      [{ template: market }, { template: beach, name: 'Beach day' }, { template: coffee }],
      [...beachPool(4), shot('street', 9)],
    );
    const first = unwrap(await fitter.fitTemplates(input()));
    expect(first.templates).toBe(3);
    expect(first.poolShots).toBe(5);
    expect(first.fits[0]?.summary.name).toBe('Beach day');
    expect(first.fits.every((fit) => fit.coverage === 1)).toBe(true);
    expect(meanOf(nth(first.fits, 0))).toBeGreaterThan(meanOf(nth(first.fits, 1)));
    const again = unwrap(await fitter.fitTemplates(input()));
    expect(again.fits.map((fit) => fit.summary.id)).toEqual(first.fits.map((fit) => fit.summary.id));
  });

  it('ranks by the score over every slot: a template the pool fills beats a longer one it fills 3 of 5', async () => {
    const short = themed(['beach', 'beach']);
    const long = themed(['beach', 'beach', 'beach', 'beach', 'beach']);
    const { fitter } = await fitWorld([{ template: long }, { template: short }], beachPool(3));
    const result = unwrap(await fitter.fitTemplates(input()));
    expect(result.fits.map((fit) => [fit.summary.id, fit.covered, fit.slots])).toEqual([
      [short.id, 2, 2],
      [long.id, 3, 5],
    ]);
  });

  it('returns `limit` fits and still scores every template', async () => {
    const themes: Theme[] = ['beach', 'market', 'coffee', 'street'];
    const { fitter } = await fitWorld(
      themes.map((theme) => ({ template: themed([theme, theme]) })),
      beachPool(4),
    );
    const result = unwrap(await fitter.fitTemplates(input({ limit: 2 })));
    expect(result.templates).toBe(4);
    expect(result.fits).toHaveLength(2);
  });
});

describe('fit: what each template is short of', () => {
  it('counts a shot once: two slots and one usable shot fill one slot, the other is taken', async () => {
    const template = themed(['beach', 'beach']);
    const { fitter } = await fitWorld([{ template }], beachPool(1));
    const [fit] = unwrap(await fitter.fitTemplates(input())).fits;
    expect([fit?.covered, fit?.coverage]).toEqual([1, 0.5]);
    expect(fit?.weakSlots).toEqual([
      { slotId: nth(template.slots, 1).id, index: 1, intent: 'beach', shotType: null, reason: 'taken' },
    ]);
  });

  it('a slot only other orientations could fill is short for orientation; one nothing fits, noShot', async () => {
    const template = themed(['beach', 'market'], {
      slots: [
        { frames: 30, text: 'beach' },
        { frames: 400, text: 'market' },
      ],
    });
    const { fitter } = await fitWorld([{ template }], [shot('beach', 1, { orientation: 'landscape' })]);
    const [fit] = unwrap(await fitter.fitTemplates(input())).fits;
    expect(fit?.coverage).toBe(0);
    expect(fit?.meanScore).toBeNull();
    expect(fit?.hook).toBeNull();
    expect(fit?.weakSlots.map((slot) => [slot.index, slot.reason])).toEqual([
      [0, 'orientation'],
      [1, 'noShot'],
    ]);
  });

  it('matches distinct shots for as many slots as can be filled, not greedily', async () => {
    // Slot 0 likes the beach shot best, but only the beach shot is long enough for slot 1.
    const template = themed(['beach', 'beach'], {
      slots: [
        { frames: 30, text: 'beach' },
        { frames: 200, text: 'beach' },
      ],
    });
    const pool = [shot('beach', 1, { frames: 300 }), shot('street', 2, { frames: 60 })];
    const { fitter } = await fitWorld([{ template }], pool);
    const [fit] = unwrap(await fitter.fitTemplates(input())).fits;
    expect(fit?.covered).toBe(2);
  });
});

describe('fit: scope and pool', () => {
  it('leaves unlisted templates out unless named, and fits only named ones when given', async () => {
    const listed = themed(['beach']);
    const plan = themed(['beach']);
    const { fitter } = await fitWorld(
      [{ template: listed }, { template: plan, listed: false }],
      beachPool(2),
    );
    const all = unwrap(await fitter.fitTemplates(input()));
    expect(all.fits.map((fit) => fit.summary.id)).toEqual([listed.id]);
    const named = unwrap(await fitter.fitTemplates(input({ templates: { templateIds: [plan.id] } })));
    expect(named.fits.map((fit) => fit.summary.id)).toEqual([plan.id]);
  });

  it('reads the pool by asset and leaves out shots with no vector', async () => {
    const template = themed(['beach', 'beach']);
    const kept = shot('beach', 1);
    const pool = [kept, shot('beach', 2), shot('beach', 3, { embedding: new Float32Array(0) })];
    const { fitter } = await fitWorld([{ template }], pool);
    const byAsset = unwrap(await fitter.fitTemplates(input({ pool: { assetIds: [kept.assetId] } })));
    expect([byAsset.poolShots, byAsset.fits[0]?.covered]).toEqual([1, 1]);
    expect(unwrap(await fitter.fitTemplates(input())).poolShots).toBe(2);
  });

  it('fits the head as it is now: an edit made a moment ago is synced first', async () => {
    const template = themed(['market', 'market']);
    const world = await fitWorld([{ template }], beachPool(2));
    const before = meanOf(nth(unwrap(await world.fitter.fitTemplates(input())).fits, 0));
    const slots = template.slots.map((slot) => ({ ...slot, intent: { ...slot.intent, text: 'beach' } }));
    const next = { ...template, slots, version: 2, parentVersion: 1 };
    unwrap(await world.store.addVersion(next, { command: 'x.y', source: 'ui', changeKey: 'k' }));
    const after = nth(unwrap(await world.fitter.fitTemplates(input())).fits, 0);
    expect(after.version).toBe(2);
    expect(meanOf(after)).toBeGreaterThan(before);
  });

  it("answers the space's error when no template index is open", async () => {
    const world = await fitWorld([{ template: themed(['beach']) }], beachPool(1));
    const fitter = createTemplateFitter({
      profiles: world.catalog,
      templates: world.store,
      vectors: async () => err(ValidationError({ field: 'space' })),
    });
    expect((await fitter.fitTemplates(input())).ok).toBe(false);
  });

  it('a template id that does not exist is template_not_found', async () => {
    const world = await fitWorld([], beachPool(1));
    const missing = newId<'Template'>() as TemplateId;
    const result = await world.fitter.fitTemplates(input({ templates: { templateIds: [missing] } }));
    expect(!result.ok && result.error.code).toBe('timeline.template_not_found');
  });
});

describe('fit and casting agree', () => {
  it("gathers and scores each slot's candidates exactly as casting's step 1 does", async () => {
    const template = themed(['beach', 'market', 'coffee', 'beach']);
    const pool = [
      ...beachPool(6),
      ...[1, 2, 3].map((n) => shot('market', 20 + n, { motionClass: 'pan', faceCount: 1 })),
      shot('coffee', 30, { quality: 0.3 }),
      shot('coffee', 31, { frames: 20 }),
      shot('street', 32, { orientation: 'landscape' }),
    ];
    const world = await fitWorld([{ template }], pool);
    const specs = slotSpecs(template, CASTING_CONFIG);
    const recent = unwrap(await world.catalog.recent(CASTING_CONFIG.hook.recentShots));
    const context = { config: CASTING_CONFIG, recent };
    const pools = unwrap(
      await templatePools(
        { specs, locked: new Map(), scope: {}, excluded: new Set() },
        { ...context, catalog: world.catalog, embedder: embedder() },
      ),
    );
    const listed = unwrap(await world.catalog.list({}, 5000));
    const packed = packPool(
      listed.map((profile) => profile.embedding),
      DIMS,
    );
    const shots = { profiles: listed, keys: listed.map(profileKey) };
    // One memo across the slots, as one fit call shares it.
    const passing = new Map<string, readonly number[]>();
    specs.forEach((spec, index) => {
      const cosines = cosinesTo(direction(spec.intentText as Theme), packed);
      const fit = slotCandidates(spec, cosines, shots, { ...context, passing }).candidates;
      const cast = [...nth(pools, index).candidates].sort(
        (a, b) => b.unary - a.unary || (a.key < b.key ? -1 : 1),
      );
      expect(fit.map((candidate) => candidate.key)).toEqual(cast.map((candidate) => candidate.key));
      fit.forEach((candidate, at) => expect(candidate.unary).toBeCloseTo(nth(cast, at).unary, 12));
    });
  });

  it("embeds the words casting embeds: casting's intentText is templates' slotIntentText", () => {
    expect(intentText).toBe(slotIntentText);
  });
});
