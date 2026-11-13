// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- made-up template and library words: data, never translated */

/**
 * FIX-ASK's gapFix cards, all made up: a 13-shot video with 12 clips that fit (shot 9 has nothing; the opening's clip
 * is unsure, and the clip that shows what it asks for is in shot 3), asking with Taalcut's proposals chosen; the next
 * round after Add more clips; and what autopilot settled, said plainly.
 */
import type { CardOf, Id } from '@taalcut/core';
import { at, PROJECT, RUN, TIMELINE } from './fixtures-phase3-ids';

type Card = CardOf<'gapFix'>;
type Gap = Card['gaps'][number];

const id = <B extends string>(tail: string) => `01K7C5M6Q8R9S0T1V2W3X4Y7${tail}` as Id<B>;
const clip = (n: string, description: string | null, fit: number) => ({
  assetId: id<'Asset'>(`A${n}`),
  shotId: id<'Shot'>(`B${n}`),
  description,
  fit,
});

const PHONE = clip('1', 'Someone checks a phone on a park bench, then smiles', 0.84);
const NEON = clip('2', 'A neon sign over a shop door at night', 0.45);
const WALKWAY = clip('3', 'A long walk down a lit walkway at dusk', 0.61);
const TRAM = clip('4', 'A tram passes the market in the rain', 0.38);
const SHOT_3 = id<'TimelineItem'>('C3');

/** Shot 1, the opening: an unsure neon sign; shot 3's phone clip fits it far better. */
const opening = (outcome: Gap['outcome'] = 'open'): Gap => ({
  gapId: id<'TimelineItem'>('C1'),
  slotId: id<'TemplateSlot'>('D1'),
  number: 1,
  start: at(0),
  duration: at(60),
  intent: {
    text: 'Someone checking a phone, surprised by a message',
    shotType: 'close',
    motion: 'static',
    energy: 0.6,
  },
  note: null,
  weak: { pick: NEON, confidence: 0.3, betterFit: false },
  wants: 'someone checking a phone',
  closest: { ...PHONE, usedIn: 3 },
  carries: ['text', 'graphics'],
  options: [
    { kind: 'keep' },
    {
      kind: 'borrow',
      candidates: [
        { ...PHONE, from: { gapId: SHOT_3, number: 3, fit: 0.31 }, instead: { ...NEON, fit: 0.33 } },
      ],
    },
    { kind: 'addClips' },
    { kind: 'film' },
    { kind: 'drop', newDuration: at(780) },
  ],
  unavailable: [{ kind: 'generate', reason: 'localOnly' }],
  outcome,
  proposed: { fix: 'borrow', swapTo: { assetId: PHONE.assetId, shotId: PHONE.shotId } },
});

/** Shot 9: nothing shows hands paying at a stall; another part of the walkway clip comes closest. */
const nine = (outcome: Gap['outcome'] = 'open'): Gap => ({
  gapId: id<'TimelineItem'>('C9'),
  slotId: id<'TemplateSlot'>('D9'),
  number: 9,
  start: at(480),
  duration: at(60),
  intent: {
    text: 'Hands paying at a market stall, coins changing hands',
    shotType: 'detail',
    motion: 'handheld',
    energy: 0.5,
  },
  note: 'noCandidates',
  wants: 'hands paying at a market stall',
  closest: { ...WALKWAY, usedIn: 5 },
  options: [
    {
      kind: 'reuse',
      candidates: [{ ...WALKWAY, usedIn: 5, sourceStart: { value: 300, rate: { num: 30, den: 1 } } }],
    },
    { kind: 'addClips' },
    { kind: 'film' },
    { kind: 'drop', newDuration: at(780) },
  ],
  unavailable: [{ kind: 'generate', reason: 'localOnly' }],
  outcome,
  proposed: { fix: 'film' },
});

/** Shot 4: unsure, nothing fits it better; it stays. */
const four = (outcome: Gap['outcome'] = 'open'): Gap => ({
  gapId: id<'TimelineItem'>('C4'),
  slotId: id<'TemplateSlot'>('D4'),
  number: 4,
  start: at(180),
  duration: at(60),
  intent: {
    text: 'The market from above as the lights come on',
    shotType: 'wide',
    motion: 'pan',
    energy: 0.7,
  },
  note: null,
  weak: { pick: TRAM, confidence: 0.35, betterFit: false },
  wants: 'the market from above as the lights come on',
  options: [{ kind: 'keep' }, { kind: 'addClips' }, { kind: 'film' }, { kind: 'drop', newDuration: at(780) }],
  unavailable: [{ kind: 'generate', reason: 'localOnly' }],
  outcome,
  proposed: { fix: 'keep' },
});

const card = (cardId: string, gaps: Gap[], extra: Partial<Card> = {}): Card => ({
  type: 'gapFix',
  id: cardId,
  version: 1,
  runId: RUN,
  projectId: PROJECT,
  timelineId: TIMELINE,
  revision: 99,
  gaps,
  summary: { shots: 13, filled: 12, empty: 1, unsure: 2 },
  ...extra,
});

export const GAP_ASK_FIXTURES: Readonly<Record<string, Card>> = {
  ownerAsking: card('gaps-owner-asking', [opening(), four(), nine()], {
    asking: { approvalId: 'ap-owner', why: ['empty', 'opening', 'carries'] },
  }),
  clipsAdded: card('gaps-clips-added', [opening('borrowed'), four('kept'), nine()], {
    asking: { approvalId: 'ap-owner-2', why: ['empty'] },
    newClips: { added: 2, ready: 1, used: 0 },
  }),
  noClipsCame: card('gaps-no-clips', [nine()], {
    asking: { approvalId: 'ap-owner-3', why: ['empty'] },
    newClips: { added: 0, ready: 0, used: 0 },
  }),
  autopilotSettled: card('gaps-autopilot', [opening('borrowed'), four('kept'), nine('open')]),
  reusedSettled: card('gaps-reused', [
    {
      ...nine('reused'),
      proposed: { fix: 'reuse', swapTo: { assetId: WALKWAY.assetId, shotId: WALKWAY.shotId } },
    },
  ]),
};
