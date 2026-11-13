// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1: the breakdown's listening against the template's slots. The breakdown hears every candidate cut, before
 * the Analyst's verdicts; the template keeps the cuts that became slots, each sync item and effect under the index
 * of the slot whose cut it is (`cutIndex` ≥ 1: the first slot starts with the reel, not at a cut), and the shares
 * over the kept cuts. Pure.
 */
import {
  CUT_SYNC_MISSES,
  RationalTime,
  type AudioProfile,
  type CutSyncItem,
  type CutSyncReport,
  type FrameRate,
  type TemplateListening,
} from '@taalcut/core';

const ON_BEAT_MS = 50;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The report's shares over `items` (as audio's sync computes them), the chance it gave kept. */
function reportOver(report: CutSyncReport, items: readonly CutSyncItem[]): CutSyncReport {
  const share = (test: (item: CutSyncItem) => boolean) =>
    items.length === 0 ? 0 : round3(items.filter(test).length / items.length);
  const offsets = items.flatMap((item) => (item.offsetMs === null ? [] : [Math.abs(item.offsetMs)]));
  const misses: readonly string[] = CUT_SYNC_MISSES;
  return {
    ...report,
    items: [...items],
    cutsWithoutHit: items.filter((item) => misses.includes(item.status)).map((item) => item.cutIndex),
    okShare: share((item) => item.status === 'ok'),
    nearShare: share((item) => item.status === 'ok' || item.status === 'near'),
    medianOffsetMs: offsets.length > 0 ? Math.round(median(offsets) * 10) / 10 : null,
    ...(report.onBeatShare !== undefined
      ? { onBeatShare: share((item) => Math.abs(item.beatOffsetMs ?? 0) <= ON_BEAT_MS) }
      : {}),
  };
}

/**
 * Each sync item's slot: the slot starting on the item's exact frame first, then (EAR1-R2) a frame either side for
 * the items and slots still unmatched, nearest first, so an item one frame off can't take a slot whose own item is
 * on it. Every slot and item is matched at most once; the first slot (the reel's start) never.
 */
function slotsOfItems(
  items: readonly CutSyncItem[],
  slotStarts: readonly number[],
  rate: FrameRate,
): Map<CutSyncItem, number> {
  const slotAt = new Map(slotStarts.map((start, index) => [start, index]));
  const exact = (item: CutSyncItem) => (RationalTime.toSeconds(item.at) * rate.num) / rate.den;
  const matched = new Map<CutSyncItem, number>();
  const taken = new Set<number>();
  for (const item of items) {
    const slot = slotAt.get(Math.round(exact(item)));
    if (slot === undefined || slot === 0 || taken.has(slot)) continue;
    matched.set(item, slot);
    taken.add(slot);
  }
  // The breakdown wrote each cut's exact frame; a frame either side is a time that came back rounded.
  const near = items.flatMap((item, order) => {
    if (matched.has(item)) return [];
    const frame = Math.round(exact(item));
    return [frame - 1, frame + 1].flatMap((f) => {
      const slot = slotAt.get(f);
      return slot === undefined || slot === 0 || taken.has(slot)
        ? []
        : [{ item, slot, gap: Math.abs(exact(item) - f), order }];
    });
  });
  near.sort((a, b) => a.gap - b.gap || a.order - b.order || a.slot - b.slot);
  for (const { item, slot } of near) {
    if (matched.has(item) || taken.has(slot)) continue;
    matched.set(item, slot);
    taken.add(slot);
  }
  return matched;
}

/** The listening under the slots that start at `slotStarts` (frames at `rate`, the first 0). */
export function slotListening(
  listening: TemplateListening,
  slotStarts: readonly number[],
  rate: FrameRate,
): TemplateListening {
  const slots = slotsOfItems(listening.cutSync.items, slotStarts, rate);
  const slotOfCut = new Map<number, number>();
  const items: CutSyncItem[] = [];
  for (const item of listening.cutSync.items) {
    const slot = slots.get(item);
    if (slot === undefined) continue;
    slotOfCut.set(item.cutIndex, slot);
    items.push({ ...item, cutIndex: slot, at: RationalTime.of(slotStarts[slot]!, rate) });
  }
  items.sort((a, b) => a.cutIndex - b.cutIndex);
  const sfxAtCuts = listening.sfxAtCuts
    .flatMap((effect) => {
      const slot = slotOfCut.get(effect.cutIndex);
      return slot === undefined ? [] : [{ ...effect, cutIndex: slot }];
    })
    .sort((a, b) => a.cutIndex - b.cutIndex);
  return { ...listening, cutSync: reportOver(listening.cutSync, items), sfxAtCuts };
}

/** The draft's audio profile for the template whose slots start at `slotStarts`. */
export function withSlotListening(
  audio: AudioProfile,
  slotStarts: readonly number[],
  rate: FrameRate,
): AudioProfile {
  return audio.listening ? { ...audio, listening: slotListening(audio.listening, slotStarts, rate) } : audio;
}
