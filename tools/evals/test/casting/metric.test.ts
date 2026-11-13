// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type CastingSystem, type CastingVariant } from '../../src/adapters/types';
import { scoreCasting } from '../../src/casting/run';
import { castingGatePasses, scoreCastingCases } from '../../src/casting/metric';
import { loadCastingCases, type CastingCase, type CastingPrediction } from '../../src/casting/schema';
import { tuneCasting } from '../../src/casting/tune';
import { writeJson } from '../../src/files';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-cast-'));
  dirs.push(dir);
  return dir;
}

const range = { startFrame: 0, endFrame: 10 };

function shot(asset: string) {
  return { asset, range };
}

function slot(slotIndex: number, asset: string, shotType?: string) {
  return {
    slotIndex,
    ...(shotType === undefined ? {} : { shotType }),
    acceptable: [shot(asset)],
  };
}

function labelled(overrides: Partial<CastingCase> = {}): CastingCase {
  return {
    caseId: 'day',
    library: 'lib-a',
    synthetic: false,
    template: { file: 'templates/day.json' },
    slots: [slot(0, 'a.mp4', 'wide'), slot(1, 'b.mp4', 'wide'), slot(2, 'c.mp4', 'close'), slot(3, 'd.mp4', 'close')],
    order: {
      groups: { arrival: [shot('a.mp4')], beach: [shot('b.mp4')] },
      rules: [{ before: 'arrival', after: 'beach' }],
    },
    ...overrides,
  };
}

function picks(assets: readonly string[]) {
  return assets.map((asset, slotIndex) => ({ slotIndex, asset, range }));
}

function prediction(caseId: string, variants: CastingPrediction['variants']): CastingPrediction {
  return { caseId, variants };
}

function variant(assets: readonly string[], alternates: CastingVariant['alternates'] = []): CastingPrediction['variants'][number] {
  return { picks: picks(assets), alternates };
}

const weights = {
  version: 'test',
  intent: 0.25,
  motion: 0.15,
  quality: 0.15,
  subject: 0.15,
  energy: 0.15,
};

function libraryCase(library: string, slots = 1): CastingCase {
  return labelled({
    caseId: `${library}-day`,
    library,
    slots: Array.from({ length: slots }, (_, index) => slot(index, 'hit.mp4')),
    order: null,
  });
}

describe('casting metrics', () => {
  it('passes gate 2 at exactly 0.60 pick and order acceptance', () => {
    const five = labelled({
      slots: [slot(0, 'a.mp4'), slot(1, 'b.mp4'), slot(2, 'c.mp4'), slot(3, 'd.mp4'), slot(4, 'e.mp4')],
      order: null,
    });
    const atBar = scoreCastingCases(
      [five],
      new Map([[five.caseId, prediction(five.caseId, [variant(['a.mp4', 'b.mp4', 'c.mp4', 'miss.mp4', 'miss.mp4'])])]]),
    );
    expect(atBar.pickAcceptance).toBe(0.6);
    expect(atBar.orderAcceptance).toBe(1);
    expect(castingGatePasses(atBar)).toBe(true);

    const under = scoreCastingCases(
      [five],
      new Map([[five.caseId, prediction(five.caseId, [variant(['a.mp4', 'b.mp4', 'miss.mp4', 'miss.mp4', 'miss.mp4'])])]]),
    );
    expect(under.pickAcceptance).toBe(0.4);
    expect(castingGatePasses(under)).toBe(false);
  });

  it('counts a kept order at 0.60 and a swapped pair as reordered', () => {
    const either = [shot('a.mp4'), shot('b.mp4'), shot('c.mp4'), shot('d.mp4')];
    const kept = (id: string): CastingCase =>
      labelled({
        caseId: id,
        slots: [0, 1, 2, 3].map((slotIndex) => ({ slotIndex, acceptable: either })),
      });
    const cases = ['one', 'two', 'three', 'four', 'five'].map(kept);
    const good = variant(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4']);
    const swapped = variant(['b.mp4', 'a.mp4', 'c.mp4', 'd.mp4']);
    const map = new Map(
      cases.map((item, index) => [item.caseId, prediction(item.caseId, [index < 3 ? good : swapped])]),
    );
    const atBar = scoreCastingCases(cases, map);
    expect(atBar.orderAcceptance).toBe(0.6);
    expect(atBar.pickAcceptance).toBe(1);
    expect(castingGatePasses(atBar)).toBe(true);

    const third = cases[2];
    if (third === undefined) throw new Error('missing case');
    map.set(third.caseId, prediction(third.caseId, [swapped]));
    const under = scoreCastingCases(cases, map);
    expect(under.orderAcceptance).toBe(0.4);
    expect(castingGatePasses(under)).toBe(false);
  });

  it('treats a missing group, a null order, and empty rules as specified', () => {
    const missing = labelled({
      order: { groups: { arrival: [shot('a.mp4')] }, rules: [{ before: 'arrival', after: 'beach' }] },
    });
    const dropped = scoreCastingCases(
      [missing],
      new Map([[missing.caseId, prediction(missing.caseId, [variant(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'])])]]),
    );
    expect(dropped.orderAcceptance).toBe(0);

    const open = labelled({ order: null });
    const none = labelled({ caseId: 'none', order: { groups: { arrival: [shot('a.mp4')] }, rules: [] } });
    const both = scoreCastingCases(
      [open, none],
      new Map([
        [open.caseId, prediction(open.caseId, [variant(['z.mp4', 'z.mp4', 'z.mp4', 'z.mp4'])])],
        [none.caseId, prediction(none.caseId, [variant(['z.mp4', 'z.mp4', 'z.mp4', 'z.mp4'])])],
      ]),
    );
    expect(both.orderAcceptance).toBe(1);
  });

  it('scores diversity, the hook, and vacuous alternates', () => {
    const item = labelled();
    const sameHook = scoreCastingCases(
      [item],
      new Map([
        [
          item.caseId,
          prediction(item.caseId, [
            variant(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4']),
            variant(['a.mp4', 'miss.mp4', 'miss.mp4', 'd.mp4']),
          ]),
        ],
      ]),
    );
    expect(sameHook.variantDiversity).toBe(0);

    const diverse = scoreCastingCases(
      [item],
      new Map([
        [
          item.caseId,
          prediction(item.caseId, [
            variant(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'], [{ slotIndex: 1, shots: [shot('b.mp4'), shot('nope.mp4')] }]),
            variant(['miss.mp4', 'miss.mp4', 'c.mp4', 'd.mp4']),
          ]),
        ],
      ]),
    );
    expect(diverse.variantDiversity).toBe(1);
    expect(diverse.alternatesAcceptance).toBe(0.5);

    const bare = scoreCastingCases(
      [item],
      new Map([[item.caseId, prediction(item.caseId, [variant(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'])])]]),
    );
    expect(bare.variantDiversity).toBe(0);
    expect(bare.alternatesAcceptance).toBe(1);
    expect(bare.shotTypes.map((row) => row.shotType)).toEqual(['close', 'wide']);
  });

  it('refuses to claim a synthetic run and claims a real one', () => {
    const real = labelled();
    const map = new Map([[real.caseId, prediction(real.caseId, [variant(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'])])]]);
    expect(scoreCasting([real], map).claimed).toBe(true);
    expect(scoreCasting([labelled({ synthetic: true })], map).claimed).toBe(false);
  });

  it('loads cases nested by library', () => {
    const dir = tempDir();
    writeJson(join(dir, 'lib-a', 'day.json'), labelled());
    writeJson(join(dir, 'lib-b', 'day.json'), labelled({ caseId: 'night', library: 'lib-b' }));
    const loaded = loadCastingCases(dir);
    expect(loaded.map((item) => `${item.library}/${item.caseId}`).sort()).toEqual(['lib-a/day', 'lib-b/night']);
  });
});

describe('tune:casting', () => {
  it('keeps a step only when train acceptance strictly rises, and holds out the third library', async () => {
    const cases = [libraryCase('lib-a'), libraryCase('lib-b'), libraryCase('lib-c', 4)];
    const calls: { library: string; intent: number }[] = [];
    const system: CastingSystem = {
      async cast(input) {
        calls.push({ library: input.library, intent: input.weights.intent });
        const item = cases.find((candidate) => candidate.caseId === input.caseId);
        if (item === undefined) throw new Error(input.caseId);
        const trainHit = input.library !== 'lib-c' && input.weights.intent >= 0.3;
        const holdoutHit = input.library === 'lib-c' && input.weights.intent < 0.3;
        const asset = trainHit || holdoutHit ? 'hit.mp4' : 'miss.mp4';
        return [{ picks: item.slots.map((row) => ({ slotIndex: row.slotIndex, asset, range })), alternates: [] }];
      },
    };
    const raised = await tuneCasting(cases, system, weights);
    expect(raised.trainLibraries).toEqual(['lib-a', 'lib-b']);
    expect(raised.holdoutLibrary).toBe('lib-c');
    expect(raised.weights.intent).toBe(0.3);
    expect(raised.trainPickAcceptance).toBe(1);
    expect(raised.holdoutPickAcceptance).toBe(0);
    const holdoutCalls = calls.filter((call) => call.library === 'lib-c');
    expect(holdoutCalls).toEqual([{ library: 'lib-c', intent: 0.3 }]);
    expect(calls.at(-1)?.library).toBe('lib-c');
    expect(calls.filter((call) => call.library !== 'lib-c').length).toBeGreaterThan(0);

    const steady = await tuneCasting(cases, system, { ...weights, intent: 0.4 });
    expect(steady.weights.intent).toBe(0.4);
    expect(steady.weights.motion).toBe(0.15);
  });

  it('refuses to tune fewer than three libraries', async () => {
    const system: CastingSystem = { async cast() { return [{ picks: [], alternates: [] }]; } };
    await expect(tuneCasting([libraryCase('lib-a'), libraryCase('lib-b')], system, weights)).rejects.toThrow(/three libraries/);
  });
});
