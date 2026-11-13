// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hits as `sfx.setHits` records: planned hits with the assets their sounds became, and the effects track's clips
 * read back as hits (so a generated hit joins the ones already there). EAR1-K3: a planned hit names the cut it was
 * placed for (`cut`), which its clip keeps as its sync point and a read-back hit gets back.
 */
import { newId, RationalTime, type AssetId, type SfxHit, type Timeline } from '@taalcut/core';
import { trackOfRole } from '../commands/audio-track';
import { MILLISECONDS } from '../rates';
import type { PlannedHit } from './hit-plan';

const ms = (value: number) => RationalTime.of(Math.round(value), MILLISECONDS);

export function toHits(planned: readonly PlannedHit[], assets: ReadonlyMap<string, AssetId>): SfxHit[] {
  return planned.flatMap((hit) => {
    const assetId = assets.get(hit.item.id);
    return assetId
      ? [
          {
            id: newId<'TimelineItem'>(),
            at: ms(hit.startMs),
            assetId,
            sourceStart: ms(hit.sourceStartMs),
            duration: ms(hit.durationMs),
            gainDb: hit.gainDb,
            category: hit.category,
            cut: ms(hit.cutMs),
          },
        ]
      : [];
  });
}

/** The effects track's clips as hits again (their category isn't stored on the clip: 'hit'). */
export function existingHits(timeline: Timeline): SfxHit[] {
  const track = trackOfRole(timeline, 'sfx');
  const rate = timeline.canvas.rate;
  const hits: SfxHit[] = [];
  let at = 0;
  for (const item of track?.items ?? []) {
    if (item.type === 'transition') continue;
    if (item.type === 'clip' && item.media.kind === 'audio') {
      const start = RationalTime.of(at, rate);
      // EAR1-K3: the clip's sync point is the source instant on its cut: the cut is that far after its start.
      const cut = item.syncPoint
        ? RationalTime.add(start, RationalTime.subtract(item.syncPoint, item.sourceStart))
        : undefined;
      hits.push({
        id: item.id,
        at: start,
        assetId: item.media.assetId,
        sourceStart: item.sourceStart,
        duration: item.duration,
        gainDb: Math.max(-40, Math.min(0, item.audio.gainDb)),
        category: 'hit',
        ...(cut ? { cut } : {}),
      });
    }
    at += item.duration.value;
  }
  return hits;
}
