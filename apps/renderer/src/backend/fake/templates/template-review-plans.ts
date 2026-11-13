// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output and on-screen text: data, never translated */

/**
 * BRK1-REV: the fake's two reels for the review, read the way a BRK1 breakdown reads them: with what it isn't sure
 * of (contract §1's doubts) and the look of its overlays (§3's designs). "Rainy market walk" is portrait, with a
 * false cut, a whip that may be one shot, a vague description, a fade's black tail, a shop sign OCR took for text,
 * and a tempo and a sound credit to check; "Coast road trip" is landscape, 15 slots, with an unsure cut, a vague
 * description, a road sign and misheard speech. Both keep their reel (e2e/sample-media/reel-*.mp4, made by
 * make-reels.mjs to these cuts). Unlisted: read in a chat and not saved, so the library's lists don't show them.
 */
import type { Id, Template } from '@taalcut/core';
import { withMeasure, type UnsureMove } from './fake-camera-measures';
import { coastRoadGraphics } from './fake-graphic-briefs';
import { buildTemplate, slotId } from './template-data';
import { GOLDEN_HOUR, type TemplatePlan } from './template-plans';

export const RAINY_MARKET: TemplatePlan = {
  n: 6,
  name: 'Rainy market walk',
  platform: 'reels',
  bpm: 120,
  beatFrames: 15,
  scene: 3,
  language: 'en',
  slots: [
    {
      beats: 3,
      role: 'hook',
      text: 'Umbrellas crowd a narrow lane, rain on the lens',
      shotType: 'wide',
      motion: 'handheld',
      energy: 0.7,
    },
    {
      beats: 2,
      role: 'body',
      text: 'A vendor ladles soup into a paper bowl',
      shotType: 'detail',
      motion: 'static',
      energy: 0.4,
    },
    { beats: 2, role: 'body', text: 'A street', shotType: 'medium', motion: 'static', energy: 0.3 },
    {
      beats: 2,
      role: 'body',
      text: 'A neon sign flickers over the stall, the camera drifting right',
      shotType: 'close',
      motion: 'pan',
      energy: 0.5,
    },
    {
      beats: 1,
      role: 'body',
      text: 'The same neon sign, a moment later',
      shotType: 'close',
      motion: 'pan',
      energy: 0.5,
    },
    {
      beats: 3,
      role: 'peak',
      text: 'Steam pours up as the lid comes off, pushing in',
      shotType: 'detail',
      motion: 'push-in',
      energy: 0.85,
    },
    {
      beats: 2,
      role: 'body',
      text: 'A friend tastes it, eyes closed, handheld and close',
      shotType: 'medium',
      motion: 'handheld',
      energy: 0.6,
    },
    {
      beats: 2,
      role: 'body',
      text: 'The crowd from above, umbrellas like dots',
      shotType: 'aerial',
      motion: 'static',
      energy: 0.45,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Paper lanterns swing over the lane, tilting up',
      shotType: 'wide',
      motion: 'tilt',
      energy: 0.5,
    },
    {
      beats: 1,
      role: 'outro',
      text: 'The lane fades to black',
      shotType: 'wide',
      motion: 'static',
      energy: 0.2,
    },
  ],
  overlays: [
    { slot: 1, text: 'where to eat when it pours', role: 'caption' },
    { slot: 3, text: 'OPEN 24H', role: 'label' },
    { slot: 7, text: 'save this for the next storm', role: 'cta' },
  ],
};

export const COAST_ROAD: TemplatePlan = {
  n: 7,
  name: 'Coast road trip',
  platform: 'shorts',
  bpm: 120,
  beatFrames: 15,
  scene: 1,
  language: 'en',
  slots: [
    {
      beats: 3,
      role: 'hook',
      text: 'A car crests a hill, the sea opening up below',
      shotType: 'aerial',
      motion: 'tracking',
      energy: 0.8,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Hands on the wheel, sun through the windscreen',
      shotType: 'close',
      motion: 'handheld',
      energy: 0.5,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Cliffs slide past the passenger window',
      shotType: 'wide',
      motion: 'tracking',
      energy: 0.6,
    },
    {
      beats: 2,
      role: 'body',
      text: 'A lighthouse on the point, slow push in',
      shotType: 'wide',
      motion: 'push-in',
      energy: 0.4,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Feet out of the window, the road behind',
      shotType: 'medium',
      motion: 'handheld',
      energy: 0.6,
    },
    {
      beats: 2,
      role: 'body',
      text: 'A road sign flashes by',
      shotType: 'medium',
      motion: 'tracking',
      energy: 0.6,
    },
    {
      beats: 2,
      role: 'body',
      text: 'A fish stall on the harbour, gulls overhead',
      shotType: 'wide',
      motion: 'pan',
      energy: 0.5,
    },
    {
      beats: 1,
      role: 'body',
      text: 'The same stall, closer',
      shotType: 'medium',
      motion: 'pan',
      energy: 0.5,
    },
    {
      beats: 2,
      role: 'peak',
      text: 'Jumping off the rocks into the water',
      shotType: 'wide',
      motion: 'tracking',
      energy: 0.95,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Surfacing, laughing, water everywhere',
      shotType: 'close',
      motion: 'handheld',
      energy: 0.8,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Towels on hot rocks',
      shotType: 'detail',
      motion: 'static',
      energy: 0.3,
    },
    { beats: 2, role: 'body', text: 'Something by the sea', shotType: 'wide', motion: 'static', energy: 0.3 },
    {
      beats: 2,
      role: 'body',
      text: 'Chips on the sea wall, wind in the paper',
      shotType: 'detail',
      motion: 'handheld',
      energy: 0.4,
    },
    {
      beats: 2,
      role: 'body',
      text: 'The sun drops behind the headland',
      shotType: 'wide',
      motion: 'static',
      energy: 0.35,
    },
    {
      beats: 2,
      role: 'outro',
      text: 'Tail lights down the coast road at dusk',
      shotType: 'wide',
      motion: 'tracking',
      energy: 0.4,
    },
  ],
  overlays: [
    { slot: 0, text: 'DAY 1', role: 'title' },
    { slot: 5, text: 'SPEED LIMIT 50', role: 'label' },
    { slot: 12, text: 'worth every mile', role: 'caption' },
    { slot: 6, text: 'FRESH FISH', role: 'label' },
  ],
};

type Doubt = { readonly reason: string; readonly confidence?: number };
type Design = Record<string, unknown>;

const design = (kind: string, fill: string | null, text: string, extra: Partial<Design> = {}): Design => ({
  kind,
  colors: { fill, text, stroke: null },
  cornerRadius: kind === 'chatBubble' ? 0.45 : kind === 'pill' ? 0.5 : 0,
  tail: kind === 'chatBubble' ? 'left' : 'none',
  font: { class: kind === 'kineticTitle' ? 'display' : 'sans', weight: kind === 'plain' ? 500 : 700 },
  motion: { enter: kind === 'chatBubble' ? 'pop' : 'fade', exit: 'fade', typing: kind === 'chatBubble' },
  confidence: 0.82,
  ...extra,
});

/** A plan built, then read as BRK1 reads it: doubts on slots, text and the reel, and designs on the overlays. */
function withReading(
  plan: TemplatePlan,
  reading: {
    readonly slots: Readonly<
      Record<number, { readonly doubts: Doubt[]; readonly cut?: number; readonly unsure?: UnsureMove }>
    >;
    readonly text: Readonly<Record<number, { readonly doubts?: Doubt[]; readonly design?: Design }>>;
    readonly reel: Doubt[];
    readonly landscape?: boolean;
  },
): Template {
  const built = buildTemplate(plan);
  const slots = built.slots.map((slot, index) => {
    const read = reading.slots[index];
    // FRM1-MOT: every slot's camera was measured; one read unsurely leaves its motion unknown.
    const measured = withMeasure(slot, read?.unsure);
    if (!read) return measured;
    return {
      ...measured,
      ...(read.cut !== undefined ? { cut: { method: 'scdet' as const, confidence: read.cut } } : {}),
      doubts: read.doubts,
    };
  });
  const text = built.text.map((item, index) => {
    const read = reading.text[index];
    return read
      ? {
          ...item,
          ...(read.doubts ? { doubts: read.doubts } : {}),
          ...(read.design ? { design: read.design } : {}),
        }
      : item;
  });
  const wide = reading.landscape === true;
  const template = {
    ...built,
    slots,
    text,
    doubts: reading.reel,
    audio: {
      ...built.audio,
      sound: reading.reel.some((d) => d.reason === 'soundCreditMissing') ? null : built.audio.sound,
    },
    ...(wide
      ? {
          canvas: { ...built.canvas, width: 1920, height: 1080 },
          origin:
            built.origin.kind === 'reference'
              ? { ...built.origin, source: { ...built.origin.source, width: 1920, height: 1080 } }
              : built.origin,
          contactSheet: built.contactSheet
            ? { ...built.contactSheet, tile: { width: 160, height: 90 } }
            : null,
        }
      : {}),
  };
  return template as Template;
}

export function rainyMarket(): Template {
  return withReading(RAINY_MARKET, {
    slots: {
      2: { doubts: [{ reason: 'intentVague', confidence: 0.7 }] },
      4: { doubts: [{ reason: 'cutUnsure', confidence: 0.41 }], cut: 0.41 },
      5: { doubts: [{ reason: 'cutMaybeTransition', confidence: 0.55 }], cut: 0.62 },
      9: { doubts: [{ reason: 'fadeTail', confidence: 0.8 }] },
    },
    text: {
      0: { design: design('chatBubble', '#ffffff', '#1b1b1b') },
      1: {
        doubts: [{ reason: 'textMaybeScene', confidence: 0.74 }],
        design: design('plain', null, '#ff3b6b'),
      },
      2: { design: design('pill', '#ffd84d', '#1b1b1b') },
    },
    reel: [{ reason: 'tempoMaybeHalfOrDouble', confidence: 0.6 }, { reason: 'soundCreditMissing' }],
  });
}

export function coastRoad(): Template {
  // DSG1-READ: its graphics read as design, and the stall's sign read as footage (fake-graphic-briefs.ts).
  return coastRoadGraphics(
    withReading(COAST_ROAD, {
      slots: {
        6: {
          doubts: [{ reason: 'motionUnsure', confidence: 0.58 }],
          unsure: { label: 'pan', confidence: 0.42 },
        },
        7: { doubts: [{ reason: 'cutUnsure', confidence: 0.38 }], cut: 0.38 },
        11: { doubts: [{ reason: 'intentVague', confidence: 0.66 }] },
      },
      text: {
        0: { design: design('kineticTitle', null, '#ffffff') },
        1: { doubts: [{ reason: 'textMaybeScene', confidence: 0.81 }] },
        2: { design: design('lowerThird', '#0f2a3a', '#ffffff') },
      },
      reel: [{ reason: 'speechMaybeHallucinated', confidence: 0.7 }],
      landscape: true,
    }),
  );
}

/** The review's reels in the fake's library: each template and its name. */
export function reviewTemplates(): { readonly template: Template; readonly name: string }[] {
  return [
    { template: rainyMarket(), name: RAINY_MARKET.name },
    { template: coastRoad(), name: COAST_ROAD.name },
  ];
}

export const reviewSlotId = (plan: TemplatePlan, index: number): Id<'TemplateSlot'> => slotId(plan, index);

/**
 * The sample files (e2e/sample-media, make-reels.mjs) for the templates whose reel the fake plays: the reel, and its
 * contact sheet made from the reel's own frames, by template id and by sheet asset.
 */
let files: { readonly reels: Map<string, string>; readonly sheets: Map<string, string> } | null = null;
function reelFiles() {
  if (files) return files;
  const golden = buildTemplate(GOLDEN_HOUR);
  const known = [
    { template: golden, file: 'reel-golden' },
    { template: rainyMarket(), file: 'reel-portrait' },
    { template: coastRoad(), file: 'reel-landscape' },
  ];
  files = {
    reels: new Map(known.map(({ template, file }) => [template.id, `${file}.mp4`])),
    sheets: new Map(
      known.flatMap(({ template, file }) =>
        template.contactSheet ? [[template.contactSheet.asset, `${file}-sheet.jpg`] as const] : [],
      ),
    ),
  };
  return files;
}

/** The kept reel the fake plays for a template: its own when make-reels.mjs made one, else the landscape sample. */
export const sampleReelOf = (templateId: string): string =>
  reelFiles().reels.get(templateId) ?? 'landscape.mp4';
/** The contact sheet made from that reel, when there is one. */
export const sampleSheetOf = (asset: string): string | null => reelFiles().sheets.get(asset) ?? null;
