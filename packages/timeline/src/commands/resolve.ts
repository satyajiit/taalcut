// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Resolving what a swap or a re-cast puts in a clip: the media's range from
 * the catalogue and, when the caller gave no in-point, the in-point rule
 * (a motion peak on the clip's beat anchor).
 */
import {
  err,
  NotImplementedError,
  ok,
  type AssetId,
  type AsyncResult,
  type CastCandidate,
  type MediaRef,
  type RationalTime,
  type ShotId,
  type ShotProfile,
  type SlotId,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { profileKey, type ShotCatalog } from '../casting/catalog';
import type { CastingConfig } from '../casting/config';
import { selectInPoint } from '../casting/in-points';
import { mediaRef, syncPointAt } from '../casting/result';
import { NO_ATTRIBUTES } from '../casting/attributes';
import { consumes, orientationOf, type SlotSpec } from '../casting/slots';
import type { Replacement } from '../edits/swap';
import { ItemNotFound, MediaMissing, MediaTooShort } from '../errors';
import { candidateKey } from '../model/cast';
import { findPosition, medianItemFrames, positions, videoItems, type Position } from '../model/sequence';
import { anchorFrame, beatGrid } from '../resync/grid';

/** A slot spec for an existing clip's position: its length, anchor and ramp. */
export function positionSpec(timeline: Timeline, position: Position): SlotSpec {
  const rate = timeline.canvas.rate;
  const items = videoItems(timeline);
  const grid = beatGrid(timeline.beatMap, rate, medianItemFrames(items));
  const item = position.item;
  const anchor = item.type === 'clip' && item.beatAnchor ? anchorFrame(grid, item.beatAnchor) : null;
  const speed = item.type === 'clip' ? item.speed : null;
  const frames = position.end - position.start;
  return {
    index: positions(items).findIndex((other) => other.item.id === item.id),
    slotId: (item.slotId ?? '') as SlotId,
    start: position.start,
    frames,
    anchorRel: anchor === null ? null : anchor - position.start,
    intentText: null,
    motion: null,
    energy: 0,
    people: null,
    subject: null,
    attributes: NO_ATTRIBUTES,
    graphics: [],
    terms: new Map(),
    needs: [],
    orientation: orientationOf(timeline.canvas),
    speed,
    consumes: consumes(frames, speed, rate),
  };
}

export async function profilesFor(
  catalog: ShotCatalog | undefined,
  refs: readonly { readonly assetId: string; readonly shotId: string | null }[],
): AsyncResult<Map<string, ShotProfile>> {
  if (!catalog) return err(NotImplementedError({ feature: 'timeline.catalog' }));
  const found = await catalog.profiles(refs);
  if (!found.ok) return found;
  const byKey = new Map<string, ShotProfile>();
  for (const profile of found.value) {
    byKey.set(profileKey(profile), profile);
    const assetKey = `asset:${profile.assetId}`;
    if (!byKey.has(assetKey)) byKey.set(assetKey, profile);
  }
  const missing = refs.find((ref) => !byKey.has(candidateKey(ref)));
  return missing ? err(MediaMissing({ assetId: missing.assetId })) : ok(byKey);
}

export async function resolveSwap(
  timeline: Timeline,
  payload: {
    readonly clipId: TimelineItemId;
    readonly media: { readonly assetId: AssetId; readonly shotId: ShotId | null };
    readonly sourceStart?: RationalTime;
    readonly from: 'alternate' | 'search' | 'agent';
    readonly scored?: Pick<CastCandidate, 'score' | 'parts'>;
  },
  catalog: ShotCatalog | undefined,
  config: CastingConfig,
): AsyncResult<Replacement> {
  const position = findPosition(timeline, payload.clipId);
  if (!position || position.item.type !== 'clip') return err(ItemNotFound({ itemId: payload.clipId }));
  const profiles = await profilesFor(catalog, [payload.media]);
  if (!profiles.ok) return profiles;
  const key = candidateKey(payload.media);
  const profile = profiles.value.get(key) as ShotProfile;
  const media: MediaRef = mediaRef(profile);
  const slot = timeline.cast?.slots.find((candidate) => candidate.clipId === payload.clipId);
  const alternate: CastCandidate | undefined =
    payload.from === 'alternate'
      ? slot?.alternates.find((candidate) => candidateKey(candidate) === key)
      : undefined;
  // LRN1-PREF: the pick keeps the score casting gave the shot where the person picked it (the payload's `scored`,
  // or the stored alternate's), whatever in-point it starts at, so the preference learner can compare it later.
  const recorded = (sourceStart: RationalTime, syncPoint: RationalTime | null): CastCandidate | null => {
    if (payload.scored) return { ...payload.media, sourceStart, syncPoint, ...payload.scored };
    return alternate ? { ...alternate, sourceStart, syncPoint } : null;
  };
  const spec = positionSpec(timeline, position);
  const rate = timeline.canvas.rate;
  if (payload.sourceStart) {
    const syncPoint = syncPointAt(profile, spec, payload.sourceStart, rate, config);
    return ok({
      media,
      sourceStart: payload.sourceStart,
      syncPoint,
      candidate: recorded(payload.sourceStart, syncPoint),
    });
  }
  if (alternate)
    return ok({
      media,
      sourceStart: alternate.sourceStart,
      syncPoint: alternate.syncPoint,
      candidate: alternate,
    });
  const point = selectInPoint(profile, spec, rate, config, spec.index === 0);
  if (!point) return err(MediaTooShort({ clipId: payload.clipId }));
  return ok({
    media,
    sourceStart: point.sourceStart,
    syncPoint: point.syncPoint,
    candidate: recorded(point.sourceStart, point.syncPoint),
  });
}
