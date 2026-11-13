// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pictures and words for the shots a timeline plays (its clips, the cast's
 * picks and alternates): `library.asset` once per clip file, shared by every
 * view that asks, then each shot's thumbnail through the media host (main's
 * app://media in Electron, the fake's paintings in a browser).
 */
import {
  callRpc,
  type AssetDetail,
  type AssetId,
  type ShotId,
  type Timeline,
} from '@taalcut/core';
import type { ShotFrame } from '@taalcut/ui';
import { useEffect, useMemo, useState } from 'react';
import type { Backend } from '../../backend/backend';
import { useBackend } from '../../backend/backend';
import type { MediaUrls } from '../../backend/media';
import { useMediaUrls } from '../../services/provider';

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export interface ShotLookup {
  detail(assetId: AssetId): Promise<AssetDetail | null>;
  /** The detail if it has loaded already. */
  loaded(assetId: AssetId): AssetDetail | null | undefined;
  frame(assetId: AssetId, shotId: ShotId | null, size?: FrameSize): Promise<ShotFrame | undefined>;
  /** The frame now, from what has loaded (undefined while its file loads). */
  frameNow(assetId: AssetId, shotId: ShotId | null, size?: FrameSize): ShotFrame | undefined;
}

function frameOf(detail: AssetDetail, shotId: ShotId | null, media: MediaUrls, size?: FrameSize): ShotFrame {
  const shot = shotId ? detail.shots.find((candidate) => candidate.id === shotId) : undefined;
  const thumb = shot?.thumbnail ?? detail.shots[0]?.thumbnail ?? detail.asset.thumbnail ?? null;
  return {
    url: thumb ? media.derived(size ? { key: thumb.key, ...size } : thumb) : null,
    name: detail.asset.name,
    description: shot?.description ?? detail.asset.description,
    duration: shot?.range.duration ?? detail.asset.duration,
  };
}

const lookups = new WeakMap<Backend, WeakMap<MediaUrls, ShotLookup>>();

export function shotLookup(backend: Backend, media: MediaUrls): ShotLookup {
  let byMedia = lookups.get(backend);
  if (!byMedia) lookups.set(backend, (byMedia = new WeakMap()));
  const existing = byMedia.get(media);
  if (existing) return existing;
  const details = new Map<AssetId, Promise<AssetDetail | null>>();
  const done = new Map<AssetId, AssetDetail | null>();
  const lookup: ShotLookup = {
    detail(assetId) {
      let found = details.get(assetId);
      if (!found) {
        found = callRpc(backend.library.asset({ assetId })).then((result) => {
          const value = result.ok ? result.value : null;
          done.set(assetId, value);
          // A failed lookup may work later (the file came back online).
          if (!value) details.delete(assetId);
          return value;
        });
        details.set(assetId, found);
      }
      return found;
    },
    loaded: (assetId) => done.get(assetId),
    async frame(assetId, shotId, size) {
      const detail = await lookup.detail(assetId);
      return detail ? frameOf(detail, shotId, media, size) : undefined;
    },
    frameNow(assetId, shotId, size) {
      const detail = done.get(assetId);
      return detail ? frameOf(detail, shotId, media, size) : undefined;
    },
  };
  byMedia.set(media, lookup);
  return lookup;
}

export function useShotLookup(): ShotLookup {
  const backend = useBackend();
  const media = useMediaUrls();
  return useMemo(() => shotLookup(backend, media), [backend, media]);
}

/** Every file a timeline names: its clips' and the cast's picks and alternates. */
function assetsOf(timeline: Timeline): AssetId[] {
  const ids = new Set<AssetId>();
  for (const track of timeline.tracks) {
    if (track.kind === 'text') continue;
    for (const item of track.items) if (item.type === 'clip') ids.add(item.media.assetId);
  }
  for (const slot of timeline.cast?.slots ?? []) {
    if (slot.pick) ids.add(slot.pick.assetId);
    for (const alternate of slot.alternates) ids.add(alternate.assetId);
  }
  return [...ids];
}

/**
 * Loads every file a timeline names and re-renders once they are in, so the
 * tracks, the inspector and the viewer can ask `lookup.frameNow` while drawing.
 * Returns how many have loaded (a value to depend on).
 */
export function useTimelineShots(timeline: Timeline | null | undefined, lookup: ShotLookup): number {
  const [loaded, setLoaded] = useState(0);
  const key = timeline ? assetsOf(timeline).join(',') : '';
  useEffect(() => {
    if (!key) return;
    let live = true;
    const ids = key.split(',') as AssetId[];
    void Promise.all(ids.map((id) => lookup.detail(id))).then(() => {
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [key, lookup]);
  return loaded;
}
