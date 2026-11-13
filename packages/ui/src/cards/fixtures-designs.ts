// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- made-up model output and on-screen words: data, never translated */

/**
 * HFW1-UI: graphics the AI "designed", made up for /dev/kit, the fake and the tests: a chat bubble (versions 1 and
 * 2), a price tag and a newspaper-style headline, as the compositions a timeline keeps copies of, the workspace
 * revisions their files came from, and the cards that show them. They point at the fake's Golden hour market; with
 * the fake's `media: { arranged: true, designs: true }` (backend/fake/phase3/design-arrange.ts) its first video
 * shows two bubbles (version 1, used) and the price tag (a proposal). Nothing here is a design the app ships or
 * draws: they are records for a code viewer and the editor's controls.
 */
import type { CardOf, GraphicComposition, Id, ProjectId, WorkspaceRevision } from '@taalcut/core';
import { DESIGN_FILE_SHAS as SHA, designFile } from './fixtures-design-files';
import { MEDIA_FIXTURE_IDS } from './fixtures-media';
import { at, RUN, T0 } from './fixtures-phase3-ids';

const ulid = <T extends string>(tail: string) => `01K7C5M6Q8R9S0T1V2W3X4${tail}` as Id<T>;
const hex = (pair: string) => pair.repeat(32);

export const DESIGN_FIXTURE_IDS = {
  compositions: {
    bubble: ulid<'GraphicComposition'>('MK01'),
    priceTag: ulid<'GraphicComposition'>('MK02'),
    headline: ulid<'GraphicComposition'>('MK03'),
  },
  graphics: {
    /** The incoming question and the reply, both drawn with the bubble. */
    askBubble: ulid<'TimelineItem'>('MH01'),
    replyBubble: ulid<'TimelineItem'>('MH02'),
    /** The price tag the chat proposed. */
    priceTag: ulid<'TimelineItem'>('MH03'),
  },
};

const gate = (repaired: boolean): GraphicComposition['gate'] => ({
  version: 'hfw1-gate/1',
  passed: true,
  checkedAt: T0,
  hfLint: { errors: 0, warnings: repaired ? 1 : 0 },
  checks: [
    { id: 'hfLint', status: 'pass' },
    { id: 'markup', status: 'pass' },
    { id: 'css', status: 'pass' },
    { id: 'urls', status: 'pass' },
    { id: 'limits', status: 'pass' },
    { id: 'lowering', status: 'pass', detail: 'Lowered 5 tweens; labels enter and exit kept.' },
    repaired
      ? {
          id: 'contrast',
          status: 'repaired',
          detail: 'Text was 3.9:1 over the brightest frame; the fill was darkened to reach 4.6:1.',
        }
      : { id: 'contrast', status: 'pass' },
    { id: 'bounds', status: 'pass' },
  ],
  loweredTweens: 5,
});

const provenance = (request?: string): GraphicComposition['provenance'] => ({
  model: { id: 'cloud-designer', onDevice: false },
  overlays: [],
  brief: null,
  ...(request ? { request } : {}),
  createdAt: T0,
});

const BUBBLE_VARIABLES: GraphicComposition['variables'] = [
  { type: 'text', name: 'message', maxLength: 120, sample: 'Are you at the market?' },
  { type: 'enum', name: 'side', options: ['left', 'right'], default: 'left' },
  { type: 'colour', name: 'fill', default: '#1f8bff' },
  { type: 'boolean', name: 'ticks', default: false },
];

const bubbleFiles = (css: string) => [
  designFile('bubble/index.html', SHA.bubbleHtml),
  designFile('bubble/style.css', css),
];

export const DESIGN_COMPOSITIONS = {
  bubble: {
    id: DESIGN_FIXTURE_IDS.compositions.bubble,
    version: 1,
    hash: hex('a1'),
    name: 'Chat bubble',
    entry: 'bubble/index.html',
    files: bubbleFiles(SHA.bubbleCss),
    variables: BUBBLE_VARIABLES,
    durationSeconds: 3,
    provenance: provenance(),
    gate: gate(false),
  },
  bubbleV2: {
    id: DESIGN_FIXTURE_IDS.compositions.bubble,
    version: 2,
    hash: hex('a2'),
    name: 'Chat bubble',
    entry: 'bubble/index.html',
    files: bubbleFiles(SHA.bubbleCssV2),
    variables: BUBBLE_VARIABLES,
    durationSeconds: 3,
    provenance: provenance('make the chat bubbles look like the reel’s'),
    gate: gate(true),
  },
  priceTag: {
    id: DESIGN_FIXTURE_IDS.compositions.priceTag,
    version: 1,
    hash: hex('a3'),
    name: 'Price tag',
    entry: 'pricetag/index.html',
    files: [designFile('pricetag/index.html', SHA.priceHtml), designFile('pricetag/style.css', SHA.priceCss)],
    variables: [
      { type: 'text', name: 'item', maxLength: 40, sample: 'Mangoes' },
      { type: 'text', name: 'price', maxLength: 24, sample: '₹120 a dozen' },
      { type: 'colour', name: 'accent', default: '#e4572e' },
    ],
    durationSeconds: 2.5,
    provenance: provenance('put the mango price on screen'),
    gate: gate(false),
  },
  headline: {
    id: DESIGN_FIXTURE_IDS.compositions.headline,
    version: 1,
    hash: hex('a4'),
    name: 'Newspaper headline',
    entry: 'headline/index.html',
    files: [
      designFile('headline/index.html', SHA.headlineHtml),
      designFile('headline/style.css', SHA.headlineCss),
      designFile(`assets/${SHA.grain}`, SHA.grain),
    ],
    variables: [
      { type: 'text', name: 'headline', maxLength: 60, sample: 'Market opens at dawn' },
      { type: 'text', name: 'kicker', maxLength: 30, sample: 'Morning edition' },
      { type: 'colour', name: 'ink', default: '#1d1d1f' },
    ],
    durationSeconds: 3.5,
    provenance: provenance('a newspaper-style headline at 0:04'),
    gate: gate(true),
  },
} as const satisfies Record<string, GraphicComposition>;

/**
 * The Golden hour project's workspace: the bubble's files (revision 1), then the price tag's beside them
 * (revision 2, the head). The fake's scripted designs write the next ones.
 */
export function designRevisions(projectId: ProjectId): WorkspaceRevision[] {
  const bubble = DESIGN_COMPOSITIONS.bubble.files;
  return [
    { projectId, revision: 1, base: 0, files: [...bubble], createdAt: T0 - 600_000, origin: 'agent' },
    {
      projectId,
      revision: 2,
      base: 1,
      files: [...bubble, ...DESIGN_COMPOSITIONS.priceTag.files],
      createdAt: T0 - 120_000,
      origin: 'agent',
    },
  ];
}

const card = (name: string, composition: { id: Id<'GraphicComposition'>; name: string }) => ({
  type: 'motionGraphic' as const,
  version: 1 as const,
  id: `design-${name}`,
  projectId: MEDIA_FIXTURE_IDS.project,
  timelineId: MEDIA_FIXTURE_IDS.timelines[0],
  composition,
  unmatched: [],
});

/** The designed graphics' cards, as the Designer's place step sends them. */
export const DESIGN_GRAPHIC_FIXTURES: Readonly<Record<string, CardOf<'motionGraphic'>>> = {
  'designed price tag, proposed': {
    ...card('price-tag', { id: DESIGN_FIXTURE_IDS.compositions.priceTag, name: 'Price tag' }),
    runId: RUN,
    itemId: DESIGN_FIXTURE_IDS.graphics.priceTag,
    start: at(180),
    duration: at(75),
  },
  'designed chat bubble': {
    ...card('bubble', { id: DESIGN_FIXTURE_IDS.compositions.bubble, name: 'Chat bubble' }),
    itemId: DESIGN_FIXTURE_IDS.graphics.askBubble,
    start: at(30),
    duration: at(90),
  },
};

const graphicTarget = (itemId: Id<'TimelineItem'>) => ({
  kind: 'item' as const,
  timelineId: MEDIA_FIXTURE_IDS.timelines[0],
  itemId,
  itemKind: 'graphic' as const,
});

/** A turn that gave the bubbles a new design, still proposed for one of them. */
export const DESIGN_CHANGES_FIXTURES: Readonly<Record<string, CardOf<'editChanges'>>> = {
  'new design': {
    type: 'editChanges',
    id: 'edit-changes-design',
    version: 1,
    runId: RUN,
    projectId: MEDIA_FIXTURE_IDS.project,
    timelineId: MEDIA_FIXTURE_IDS.timelines[0],
    group: `turn:${RUN}`,
    revisionBefore: 3,
    revisionAfter: 4,
    changes: [
      {
        target: graphicTarget(DESIGN_FIXTURE_IDS.graphics.askBubble),
        number: 1,
        at: 1,
        change: {
          kind: 'design',
          before: { name: 'Chat bubble', version: 1 },
          after: { name: 'Chat bubble', version: 2 },
          proposed: true,
        },
      },
      {
        target: graphicTarget(DESIGN_FIXTURE_IDS.graphics.replyBubble),
        number: 2,
        at: 2.5,
        change: { kind: 'words', before: 'Almost there', after: 'Almost there!' },
      },
    ],
    more: 0,
  },
};
