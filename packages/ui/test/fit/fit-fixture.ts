// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-TPL: fits and template summaries for the fit tests, as timelines.fitTemplates answers them. */
import type {
  FitTemplatesResult,
  FitWeakReason,
  Id,
  SourceId,
  SourceView,
  TemplateFit,
  TemplateId,
  TemplateSummary,
} from '@taalcut/core';

export const SOURCE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZF' as SourceId;
export const SOURCE_2 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZG' as SourceId;
export const templateId = (n: number) => `01K7C5M6Q8700000000000000${n}` as TemplateId;
const slotId = (n: number) => `01K7C5M6Q8800000000000000${n}` as Id<'TemplateSlot'>;

export function summaryOf(n: number, name: string, slotCount = 4): TemplateSummary {
  return {
    id: templateId(n),
    name,
    head: 1,
    origin: 'reference',
    platform: 'reels',
    duration: { value: 300, rate: { num: 30, den: 1 } },
    slotCount,
    bpm: 120,
    projectId: null,
    listed: true,
    archived: false,
    contactSheet: null,
    approvedSlots: 0,
    tags: [],
    folderId: null,
    favourite: false,
    trendFreshness: null,
    provenance: null,
    slotStrip: Array.from({ length: slotCount }, () => 75),
    formatId: null,
    language: null,
    styleId: null,
    createdAt: Date.UTC(2026, 9, n),
    updatedAt: Date.UTC(2026, 9, n),
  };
}

/** A fit of template `n`: `covered` of `slots`, the rest weak in slot order with these intents and reasons. */
export function fitOf(
  n: number,
  name: string,
  covered: number,
  meanScore: number | null,
  weak: readonly (readonly [intent: string, reason: FitWeakReason])[] = [],
): TemplateFit {
  const slots = covered + weak.length;
  return {
    summary: summaryOf(n, name, slots),
    version: 1,
    slots,
    covered,
    coverage: covered / slots,
    meanScore,
    hook: covered > 0 ? 0.6 : null,
    weakSlots: weak.map(([intent, reason], index) => ({
      slotId: slotId(index + 1),
      index: covered + index,
      intent,
      shotType: null,
      reason,
    })),
  };
}

export const resultOf = (fits: readonly TemplateFit[], over: Partial<FitTemplatesResult> = {}) => ({
  configVersion: 'casting.v1',
  poolShots: 48,
  poolTruncated: false,
  templates: fits.length,
  fits: [...fits],
  ...over,
});

/** Chai fills every slot; Market misses one its clips took; Night misses two and a third. */
export const FITS = [
  fitOf(1, 'Chai at dawn', 4, 0.82),
  fitOf(2, 'Market walk', 3, 0.71, [['Steam over the pot', 'taken']]),
  fitOf(3, 'Night lights', 2, 0.64, [
    ['Neon sign, slow push-in', 'orientation'],
    ['Crowd from above', 'noShot'],
    ['Tail lights blur', 'noShot'],
  ]),
  fitOf(4, 'Snow day', 0, null, [
    ['Snow falls', 'noShot'],
    ['Breath in cold air', 'noShot'],
  ]),
];

export function sourceOf(id: SourceId, name: string, createdAt: number): SourceView {
  return {
    id,
    kind: 'watched_folder',
    name,
    status: 'online',
    path: `/Users/me/${name}`,
    watch: false,
    scan: { state: 'idle', lastScanAt: createdAt },
    assets: 40,
    missing: 0,
    createdAt,
  };
}
