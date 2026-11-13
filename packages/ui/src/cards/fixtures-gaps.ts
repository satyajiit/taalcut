// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model, hub and provider text: data, never translated */

import type { CardOf, Id } from '@taalcut/core';
import { GAP_ASK_FIXTURES } from './fixtures-gaps-ask';
import { at, GAP, PROJECT, RUN, SLOT, TIMELINE, usd } from './fixtures-phase3-ids';

type Card = CardOf<'gapFix'>;
type Gap = Card['gaps'][number];

const GAP_2 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZN' as Id<'TimelineItem'>;
const GAP_3 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZP' as Id<'TimelineItem'>;
const SLOT_2 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZQ' as Id<'TemplateSlot'>;
const SLOT_3 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZR' as Id<'TemplateSlot'>;
/** Newer than the Make fake's Golden hour video, so /dev/kit shows the card's own state, not "already fixed". */
const AHEAD = 99;

/** Slot 3: a close-up of the pour, every fix offered. */
const pour = (outcome: Gap['outcome'] = 'open'): Gap => ({
  gapId: GAP,
  slotId: SLOT,
  number: 3,
  start: at(90),
  duration: at(75),
  intent: { text: 'A close-up of the coffee pour', shotType: 'close', motion: 'static', energy: 0.6 },
  note: outcome === 'filled' ? 'gapFilled' : 'noCandidates',
  options: [
    { kind: 'film' },
    {
      kind: 'generate',
      provider: 'google',
      model: 'imagen-4',
      estimate: usd(40_000),
      prompt: 'Coffee poured into a white cup, soft morning light',
    },
    { kind: 'stock', query: 'coffee pour close up' },
    { kind: 'drop', newDuration: at(825) },
  ],
  unavailable: [],
  outcome,
});

/** Slot 7: the street at night; stock needs a key. */
const street = (outcome: Gap['outcome'] = 'open'): Gap => ({
  gapId: GAP_2,
  slotId: SLOT_2,
  number: 7,
  start: at(390),
  duration: at(60),
  intent: { text: 'The market street lit up after dark', shotType: 'wide', motion: 'pan', energy: 0.8 },
  note: outcome === 'dropped' ? 'dropped' : 'noCandidates',
  options: [
    { kind: 'film' },
    {
      kind: 'generate',
      provider: 'google',
      model: 'imagen-4',
      estimate: usd(40_000),
      prompt: 'A busy night market street with string lights, wide shot',
    },
    { kind: 'drop', newDuration: at(840) },
  ],
  unavailable: [{ kind: 'stock', reason: 'noStockKey' }],
  outcome,
});

/** Slot 9: no story text; Local only keeps the internet fixes away. */
const hands = (outcome: Gap['outcome'] = 'open'): Gap => ({
  gapId: GAP_3,
  slotId: SLOT_3,
  number: 9,
  start: at(510),
  duration: at(45),
  intent: { text: 'Hands counting change at the stall', shotType: 'detail', motion: 'handheld', energy: 0.5 },
  note: 'noCandidates',
  options: [{ kind: 'film' }, { kind: 'drop', newDuration: at(855) }],
  unavailable: [
    { kind: 'generate', reason: 'localOnly' },
    { kind: 'stock', reason: 'localOnly' },
  ],
  outcome,
});

const GAP_4 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZS' as Id<'TimelineItem'>;
const SLOT_4 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZT' as Id<'TemplateSlot'>;
const clip = (n: number, description: string | null, fit: number) => ({
  assetId: `01K7C5M6Q8R9S0T1V2W3X4Y6A${n}` as Id<'Asset'>,
  shotId: `01K7C5M6Q8R9S0T1V2W3X4Y6B${n}` as Id<'Shot'>,
  description,
  fit,
});

/** FIX-GAPS, slot 12: a clip casting is unsure of, with three that could take its place; Local only. */
const unsure = (outcome: Gap['outcome'] = 'open', betterFit = true): Gap => ({
  gapId: GAP_4,
  slotId: SLOT_4,
  number: 12,
  start: at(600),
  duration: at(60),
  intent: {
    text: 'An open park with a landmark in daylight',
    shotType: 'wide',
    motion: 'static',
    energy: 0.4,
  },
  note: null,
  weak: { pick: clip(1, 'A city street with traffic at night', 0.35), confidence: 0.35, betterFit },
  options: [
    {
      kind: 'swap',
      candidates: [
        clip(2, 'A wide park with a monument on a sunny day', 0.86),
        clip(3, 'Trees along a path in sunlight', 0.62),
        clip(4, null, 0.4),
      ],
    },
    { kind: 'keep' },
    { kind: 'film' },
    { kind: 'drop', newDuration: at(840) },
  ],
  unavailable: [
    { kind: 'generate', reason: 'localOnly' },
    { kind: 'stock', reason: 'localOnly' },
  ],
  outcome,
});

const card = (id: string, gaps: Gap[], extra: Partial<Card> = {}): Card => ({
  type: 'gapFix',
  id,
  version: 1,
  runId: RUN,
  projectId: PROJECT,
  timelineId: TIMELINE,
  revision: AHEAD,
  gaps,
  ...extra,
});

/** P3-B8: the gap fix card while the run asks, open after it, part and all fixed, and moved on. */
export const GAP_FIX_FIXTURES: Readonly<Record<string, Card>> = {
  asking: card('gaps-asking', [pour(), street()], { asking: { approvalId: 'ap-gaps' } }),
  open: card('gaps-open', [pour(), street(), hands()]),
  partly: card('gaps-partly', [pour('filled'), street('dropped'), hands()]),
  settled: card('gaps-settled', [pour('filled'), street('dropped')]),
  alreadyFixed: card('gaps-moved-on', [pour()], { revision: 1 }),
  unsureAsking: card('gaps-unsure-asking', [unsure()], { asking: { approvalId: 'ap-unsure' } }),
  unsureSwapped: card('gaps-unsure-swapped', [unsure('swapped')]),
  unsureKept: card('gaps-unsure-kept', [unsure('kept', false)]),
  ...GAP_ASK_FIXTURES,
};
