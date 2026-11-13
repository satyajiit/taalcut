// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model, voice, provider and on-screen text: data, never translated */

import type { CardOf, Id, VoiceLine } from '@taalcut/core';
import { at, RUN, usd } from './fixtures-phase3-ids';

/**
 * P3-B6, P3-V13, P3-B7: the voiceover, voice consent, motion graphic and image takes cards, every state. They point
 * at the fake's Golden hour market project and its three variants (12 slots at 120 BPM, 30 fps). With the fake's
 * media option (`taalcut.fake` `media: { arranged: true }`) backend/fake/phase3/media-arrange.ts puts these cards'
 * voiceovers, voice tracks, graphics and image slots on those timelines, so /dev/kit shows the cards live;
 * without it the timelines have none and the cards say so.
 */
const ulid = <T extends string>(tail: string) => `01K7C5M6Q8R9S0T1V2W3X4${tail}` as Id<T>;
/** Timelines and lines count from 0 here; their ids from 1. */
type Nth = 0 | 1 | 2;
/** The Golden hour template's twelve slots, in order (the fake's template-data). */
const slot = (tail: string) => `01K7C5M6Q860000000000000${tail}` as Id<'TemplateSlot'>;
const GOLDEN_SLOTS = [
  slot('34'),
  slot('35'),
  slot('36'),
  slot('37'),
  slot('38'),
  slot('39'),
  slot('3A'),
  slot('3B'),
  slot('3C'),
  slot('3D'),
  slot('3E'),
  slot('3F'),
] as const;
/** Each line's slot: 1, 5 and 8 (canvas frames 0, 135 and 240); the image takes' slot is 4 (frame 105). */
const LINE_SLOTS = [GOLDEN_SLOTS[0], GOLDEN_SLOTS[4], GOLDEN_SLOTS[7]] as const;
const IMAGE_SLOT = GOLDEN_SLOTS[3];

export const MEDIA_FIXTURE_IDS = {
  project: '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as Id<'Project'>,
  timelines: [
    '01K7C5M6Q8R9S0T1V2W3X4Y5ZB' as Id<'Timeline'>,
    '01K7C5M6Q8N000000000000002' as Id<'Timeline'>,
    '01K7C5M6Q8N000000000000003' as Id<'Timeline'>,
  ] as const,
  slots: GOLDEN_SLOTS,
  lineSlots: LINE_SLOTS,
  imageSlot: IMAGE_SLOT,
  voiceovers: [ulid<'Voiceover'>('MV01'), ulid<'Voiceover'>('MV02'), ulid<'Voiceover'>('MV03')] as const,
  /** Line k of a voiceover plays voice clip k. */
  line: (timeline: Nth, line: number) => ulid<'VoiceLine'>(`MW${timeline + 1}${line + 1}`),
  voiceClip: (timeline: Nth, line: number) => ulid<'TimelineItem'>(`MC${timeline + 1}${line + 1}`),
  graphics: {
    halfTheStalls: ulid<'TimelineItem'>('MG01'),
    shoppingList: ulid<'TimelineItem'>('MG02'),
    nameCard: ulid<'TimelineItem'>('MG03'),
    stallRing: ulid<'TimelineItem'>('MG04'),
    risingTitle: ulid<'TimelineItem'>('MG05'),
    stallsByStreet: ulid<'TimelineItem'>('MG06'),
    /** EDT1-GFX: a name card the chat designed, still a proposal (the fake arranges it as one). */
    founderCard: ulid<'TimelineItem'>('MG07'),
  },
  /** Images in the fake library (n = 18, 63, 3, 114), standing in for generated stills. */
  takes: [
    '01K7C5M6Q8100000000000000J' as Id<'Asset'>,
    '01K7C5M6Q8100000000000001Z' as Id<'Asset'>,
    '01K7C5M6Q81000000000000003' as Id<'Asset'>,
    '01K7C5M6Q8100000000000003J' as Id<'Asset'>,
  ] as const,
};

const ids = MEDIA_FIXTURE_IDS;
const [TAKE_A, TAKE_B, TAKE_C, TAKE_D] = ids.takes;
const consent = (status: CardOf<'voiceConsent'>['status']): CardOf<'voiceConsent'> => ({
  type: 'voiceConsent',
  id: `voice-consent-${status}`,
  version: 1,
  consentId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZN' as Id<'VoiceConsent'>,
  termsVersion: '1',
  language: 'en',
  status,
  ...(status === 'mismatch' ? { heard: 'I am Mira and I agree to' } : {}),
});

/** A voiceover's three lines on timeline `t` (0-based). */
const lines = (
  t: Nth,
  words: readonly [string, string, string],
  quality: readonly VoiceLine['quality'][],
  offBeat = -1,
): VoiceLine[] =>
  words.map((text, k) => ({
    id: ids.line(t, k),
    text,
    slotId: LINE_SLOTS[k] ?? null,
    clipId: ids.voiceClip(t, k),
    assetId: null,
    quality: quality[k] ?? 'draft',
    duration: at([40, 38, 42][k] ?? 40),
    offBeat: k === offBeat,
  }));

const voiceover = (
  t: Nth,
): Pick<CardOf<'voiceover'>, 'type' | 'version' | 'runId' | 'projectId' | 'timelineId'> => ({
  type: 'voiceover',
  version: 1,
  runId: RUN,
  projectId: ids.project,
  timelineId: ids.timelines[t],
});

export const VOICEOVER_FIXTURES: Readonly<Record<string, CardOf<'voiceover'>>> = {
  draft: {
    ...voiceover(0),
    id: 'voiceover',
    voiceover: {
      id: ids.voiceovers[0],
      voiceName: 'Ana',
      own: false,
      language: 'pt-BR',
      lines: lines(
        0,
        ['Primeiro, o café.', 'Depois, o mercado acorda.', 'E a luz dourada fecha o dia.'],
        [],
        1,
      ),
    },
    quality: 'draft',
    spent: usd(8_000),
    finalizeEstimate: usd(30_000),
    ducking: { enabled: true, minMarginLu: 9 },
  },
  'your voice, mixed': {
    ...voiceover(1),
    id: 'voiceover-mixed',
    voiceover: {
      id: ids.voiceovers[1],
      voiceName: 'Mira',
      own: true,
      language: 'en',
      lines: lines(
        1,
        ['Golden hour at the market.', 'Every stall has a story.', 'Come back next week.'],
        ['final', 'final', 'draft'],
      ),
    },
    quality: 'mixed',
    spent: usd(26_000),
    finalizeEstimate: usd(9_000),
    ducking: { enabled: true, minMarginLu: 8.4 },
  },
  'final, no music': {
    ...voiceover(2),
    id: 'voiceover-final',
    voiceover: {
      id: ids.voiceovers[2],
      voiceName: 'Ravi',
      own: false,
      language: 'hi',
      lines: lines(
        2,
        ['सुबह की पहली चाय।', 'बाज़ार जाग रहा है।', 'और सुनहरी रोशनी।'],
        ['final', 'final', 'final'],
      ),
    },
    quality: 'final',
    spent: usd(41_000),
    finalizeEstimate: null,
    ducking: null,
  },
};

export const VOICE_CONSENT_FIXTURES: Readonly<Record<string, CardOf<'voiceConsent'>>> = {
  ready: consent('ready'),
  recording: consent('recording'),
  checking: consent('checking'),
  mismatch: consent('mismatch'),
  stored: consent('stored'),
  cloned: consent('cloned'),
  failed: consent('failed'),
};

const graphic = (t: Nth) => ({
  type: 'motionGraphic' as const,
  version: 1 as const,
  projectId: ids.project,
  timelineId: ids.timelines[t],
});

/**
 * HFW1: the made-up designs the fixtures' graphics are drawn with, by item: a composition's id and name (the
 * designing model's words) and its one text variable's words. Records only: the fake backend has no files to draw.
 */
export const GRAPHIC_FIXTURE_DESIGNS: Readonly<
  Record<string, { readonly id: Id<'GraphicComposition'>; readonly name: string; readonly words: string }>
> = {
  [ids.graphics.halfTheStalls]: { id: ulid('MD01'), name: 'Half the stalls', words: '50%' },
  [ids.graphics.shoppingList]: {
    id: ulid('MD02'),
    name: 'Shopping list',
    words: 'Mangoes, jasmine, masala chai',
  },
  [ids.graphics.nameCard]: { id: ulid('MD03'), name: 'Name card', words: 'Mira Shah' },
  [ids.graphics.stallRing]: { id: ulid('MD04'), name: 'Ring on the stall', words: 'Fresh mangoes' },
  [ids.graphics.risingTitle]: { id: ulid('MD05'), name: 'Rising title', words: 'Golden hour at the market' },
  [ids.graphics.stallsByStreet]: { id: ulid('MD06'), name: 'Stalls by street', words: 'Rose Lane 14' },
  [ids.graphics.founderCard]: { id: ulid('MD07'), name: 'Founder card', words: 'Asha Rao' },
};

const designed = (itemId: Id<'TimelineItem'>) => {
  const design = GRAPHIC_FIXTURE_DESIGNS[itemId]!;
  return { itemId, composition: { id: design.id, name: design.name } };
};

export const MOTION_GRAPHIC_FIXTURES: Readonly<Record<string, CardOf<'motionGraphic'>>> = {
  'half the stalls, placed by time': {
    ...graphic(0),
    id: 'graphic',
    ...designed(ids.graphics.halfTheStalls),
    start: at(120),
    duration: at(60),
    unmatched: ['fifty percent'],
  },
  'shopping list': {
    ...graphic(0),
    id: 'graphic-list',
    ...designed(ids.graphics.shoppingList),
    start: at(15),
    duration: at(90),
    unmatched: [],
  },
  // EDT1-GFX: the chat's "add a lower third with my name", designed and still a proposal.
  'founder card, proposed': {
    ...graphic(0),
    id: 'graphic-proposed',
    runId: RUN,
    ...designed(ids.graphics.founderCard),
    start: at(200),
    duration: at(90),
    unmatched: [],
  },
  'name card': {
    ...graphic(1),
    id: 'graphic-name',
    ...designed(ids.graphics.nameCard),
    start: at(15),
    duration: at(75),
    unmatched: [],
  },
  'ring on the stall': {
    ...graphic(2),
    id: 'graphic-callout',
    ...designed(ids.graphics.stallRing),
    start: at(90),
    duration: at(60),
    unmatched: ['the mango stall', 'ripe'],
  },
  'rising title': {
    ...graphic(1),
    id: 'graphic-title',
    ...designed(ids.graphics.risingTitle),
    start: at(100),
    duration: at(75),
    unmatched: [],
  },
  'stalls by street': {
    ...graphic(2),
    id: 'graphic-chart',
    ...designed(ids.graphics.stallsByStreet),
    start: at(15),
    duration: at(70),
    unmatched: [],
  },
};

const takes = (t: Nth) => ({
  type: 'imageTakes' as const,
  version: 1 as const,
  runId: RUN,
  projectId: ids.project,
  timelineId: ids.timelines[t],
  slotId: IMAGE_SLOT,
});

export const IMAGE_TAKES_FIXTURES: Readonly<Record<string, CardOf<'imageTakes'>>> = {
  one: {
    ...takes(0),
    id: 'takes',
    takes: [{ assetId: TAKE_A, provider: 'google', model: 'imagen-4', thumbnailArtifactId: 'artifact-7' }],
    placed: TAKE_A,
    spent: usd(40_000),
  },
  'four, slot still a gap': {
    ...takes(1),
    id: 'takes-four',
    takes: [
      { assetId: TAKE_A, provider: 'google', model: 'imagen-4', thumbnailArtifactId: 'artifact-7' },
      {
        assetId: TAKE_B,
        provider: 'openrouter',
        model: 'black-forest-labs/flux-2-pro',
        thumbnailArtifactId: 'artifact-8',
      },
      { assetId: TAKE_C, provider: 'xai', model: 'grok-2-image', thumbnailArtifactId: 'artifact-9' },
      { assetId: TAKE_D, provider: 'openai', model: 'gpt-image-1', thumbnailArtifactId: 'artifact-10' },
    ],
    placed: null,
    spent: usd(160_000),
  },
  two: {
    ...takes(2),
    id: 'takes-two',
    takes: [
      { assetId: TAKE_C, provider: 'google', model: 'imagen-4', thumbnailArtifactId: 'artifact-11' },
      {
        assetId: TAKE_D,
        provider: 'openrouter',
        model: 'black-forest-labs/flux-2-pro',
        thumbnailArtifactId: 'artifact-12',
      },
    ],
    placed: TAKE_C,
    spent: usd(80_000),
  },
};

export { PUBLISH_PACK_FIXTURES } from './fixtures-publish';
