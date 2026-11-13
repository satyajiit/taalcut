// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FIX-STORY's parts on their own: the words, their rarity and match, the graphics over a slot, the swap plan. */
import { describe, expect, it } from 'vitest';
import { newId, type CastCandidate, type SlotCast, type SlotId, type Template } from '@taalcut/core';
import { CASTING_CONFIG } from '../src/casting/config';
import type { CastVariant } from '../src/casting/result';
import { slotGraphicKinds } from '../src/casting/slot-graphics';
import { planReranks } from '../src/casting/swaps';
import { rarity, shotTerms, slotTerms, stem, termIndex, termMatch, thingTerms } from '../src/casting/terms';
import { makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG.terms;

describe('the words a slot and a shot say', () => {
  it('meets a word’s forms on one stem', () => {
    for (const forms of [
      ['phone', 'phones', 'phoning'],
      ['cook', 'cooks', 'cooking', 'cooked'],
      ['arrive', 'arrives', 'arriving', 'arrived'],
      ['run', 'runs', 'running'],
      ['bicycle', 'bicycles'],
      ['city', 'cities'],
      ['glass', 'glasses'],
    ])
      expect(new Set(forms.map(stem)), forms[0]).toHaveLength(1);
    // What is left of "bring" or "red" has no vowel, so they keep theirs.
    expect([stem('bring'), stem('red'), stem('sing')]).toEqual(['bring', 'red', 'sing']);
  });

  it('keeps the things and drops people, the camera, the light, colours and quoted words', () => {
    expect(thingTerms('Wide static shot of a chef chopping onions at night, then smiling')).toEqual([
      'chef',
      'chop',
      'onion',
      'smil',
    ]);
    expect(thingTerms("A woman in a red shirt that says 'Hello World' holds a guitar")).toEqual([
      'shirt',
      'say',
      'hold',
      'guitar',
    ]);
    // FIX-HOOK: a need's place words aren't things a shot has to show ("beyond", "being").
    expect(thingTerms('a kite being flown beyond the trees')).toEqual(['kit', 'flown', 'tre']);
  });

  it('reads an object tag by its last word, and a shot by its description and objects', () => {
    const shot = {
      description: 'A dog runs on the sand',
      objectTags: ['coffee cups', 'palm tree', 'person'],
    };
    expect([...shotTerms(shot)].sort()).toEqual(['cup', 'dog', 'run', 'sand', 'tre']);
  });

  it('weighs a word by how few shots show it: 1 for one, 0 for all, nothing to compare in one shot', () => {
    expect(rarity(1, 10, 1)).toBe(1);
    expect(rarity(10, 10, 1)).toBe(0);
    expect(rarity(1, 1, 1)).toBe(0);
    expect(rarity(0, 10, 1)).toBe(0);
    expect(rarity(5, 10, 2)).toBeCloseTo(rarity(5, 10, 1) ** 2, 12);
  });

  it('matches the union of the words a shot shows, and nothing for a shot that shows none', () => {
    const profiles = ['dog beach', 'beach', 'beach', 'sand'].map((words) =>
      makeProfile({ embedding: unitVector(1), description: words }),
    );
    const index = termIndex(profiles);
    const asks = slotTerms({ text: 'A dog on the beach', place: null, subject: null });
    const [dog, beach, , sand] = profiles.map((profile) => termMatch(asks, index.of(profile), index, config));
    expect(dog?.matched).toEqual(['dog', 'beach']);
    expect(dog!.score).toBeGreaterThan(0.99);
    expect(beach!.score).toBeLessThan(0.1);
    expect(sand).toBeNull();
  });

  it('asks for what the intent says in full, and nothing for its graphics (FIX-HOOK: needs say that)', () => {
    const asks = slotTerms({ text: 'Waiting for a bus', place: 'a quiet stop', subject: null });
    expect(asks.get('bus')).toBe(1);
    expect(asks.has('phon')).toBe(false);
    expect(slotTerms({ text: 'Someone reads a phone', place: null, subject: null }).get('phon')).toBe(1);
    expect(slotTerms(null).size).toBe(0);
  });
});

describe('the graphics over each slot', () => {
  const kinds = (patch: (template: Template) => Template) => {
    const built = buildTemplate({
      slots: [{ frames: 30 }, { frames: 30 }, { frames: 30 }],
      overlays: [
        { start: 2, frames: 20, text: 'Made-up question', slot: 0 },
        { start: 40, frames: 40, text: 'Made-up answer' },
      ],
    });
    return slotGraphicKinds(patch(built));
  };
  const brief = (overlayId: string, kind: string, graphic = true) => ({ overlayId, kind, graphic });

  it('reads the reading’s kinds, by the slot an overlay starts in and the slots it covers half of', () => {
    const result = kinds((t) => ({
      ...t,
      graphics: {
        uses: [],
        reading: {
          briefs: [brief(t.text[0]!.id, 'incomingMessage'), brief(t.text[1]!.id, 'outgoingMessage')],
        },
      } as unknown as Template['graphics'],
    }));
    expect(result).toEqual([['incomingMessage'], ['outgoingMessage'], ['outgoingMessage']]);
  });

  it('drops what the reading calls footage, and reads a measured chat bubble as a message', () => {
    const result = kinds((t) => ({
      ...t,
      text: t.text.map((overlay, index) =>
        index === 1
          ? {
              ...overlay,
              design: {
                kind: 'chatBubble',
                colors: { fill: '#ffffff', text: '#000000', stroke: null },
                cornerRadius: 0.3,
                tail: 'left',
                font: { class: 'sans', weight: 400 },
                motion: { enter: 'none', exit: 'none', typing: false },
                shape: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
                confidence: 0.9,
              },
            }
          : overlay,
      ),
      graphics: {
        uses: [],
        reading: { briefs: [brief(t.text[0]!.id, 'incomingMessage', false)] },
      } as unknown as Template['graphics'],
    }));
    expect(result).toEqual([[], ['incomingMessage'], ['incomingMessage']]);
  });
});

describe('the swap plan', () => {
  const slotIds = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>(), newId<'TemplateSlot'>()];
  const shots = ['A', 'B', 'C', 'D'].map(() => newId<'Shot'>() as string);
  const pick = (shotId: string): CastCandidate =>
    ({ assetId: newId<'Asset'>(), shotId, score: 0, parts: {} }) as unknown as CastCandidate;
  const base = (note: SlotCast['note'] = null): CastVariant =>
    ({
      slots: slotIds.map((slotId, index) => ({
        slotId,
        clipId: null,
        pick: pick(shots[index]!),
        alternates: [],
        confidence: 0,
        needsRerank: true,
        note: index === 1 ? note : null,
      })),
    }) as unknown as CastVariant;
  const [a, b, c, spare] = shots as [string, string, string, string];
  const [s0, s1, s2] = slotIds as [SlotId, SlotId, SlotId];

  it('swaps a slot with the slot whose pick it puts first, and keeps each shot for its slot', () => {
    const plan = planReranks([{ slotId: s0, order: [b, a, c, spare] }], base());
    expect(plan.rerank).toEqual([
      { slotId: s1, order: [a] },
      { slotId: s0, order: [b, spare] },
    ]);
    expect([...plan.reserved]).toEqual([
      [b, s0],
      [a, s1],
    ]);
    expect(plan.seed).toEqual([b, a, c]);
  });

  it('keeps an order inside its slot’s own shots, drops an empty one, and swaps a slot once', () => {
    expect(planReranks([{ slotId: s0, order: [a, c, spare] }], base()).rerank).toEqual([
      { slotId: s0, order: [a, spare] },
    ]);
    expect(
      planReranks(
        [
          { slotId: s0, order: [c] },
          { slotId: s2, order: [a] },
        ],
        base(),
      ).rerank,
    ).toEqual([
      { slotId: s2, order: [a] },
      { slotId: s0, order: [c] },
    ]);
    const twice = planReranks(
      [
        { slotId: s0, order: [b] },
        { slotId: s2, order: [b] },
      ],
      base(),
    );
    expect(twice.rerank.map((entry) => entry.slotId)).toEqual([s1, s0]);
  });

  it('never moves a user’s pick', () => {
    const plan = planReranks([{ slotId: s0, order: [b, a] }], base('userPick'));
    expect(plan.rerank).toEqual([{ slotId: s0, order: [a] }]);
    expect(plan.reserved.size).toBe(0);
  });
});
