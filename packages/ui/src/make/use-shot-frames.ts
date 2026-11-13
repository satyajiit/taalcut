// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AssetId, ShotId } from '@taalcut/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCardData, type ShotFrame } from '../cards/card-data';

export interface ShotKey {
  readonly assetId: AssetId;
  readonly shotId: ShotId | string | null;
}

export const shotKey = (shot: ShotKey): string => `${shot.assetId}:${shot.shotId ?? ''}`;

/**
 * Frames for a set of shots (picks, alternates, timeline clips) from
 * CardData.shot, each loaded once per card. The lookup answers undefined
 * until a frame arrives (the viewer grey shows meanwhile).
 */
export function useShotFrames(shots: readonly ShotKey[]): (shot: ShotKey) => ShotFrame | undefined {
  const data = useCardData();
  const [frames, setFrames] = useState<ReadonlyMap<string, ShotFrame>>(new Map());
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wanted = useMemo(() => {
    const unique = new Map<string, ShotKey>();
    for (const shot of shots) unique.set(shotKey(shot), shot);
    return unique;
    // The list changes identity every render; its keys are what matter.
  }, [shots.map(shotKey).join(' ')]);

  useEffect(() => {
    if (!data.shot) return;
    for (const [key, shot] of wanted) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      data.shot(shot.assetId, shot.shotId as ShotId | null).then(
        (frame) => {
          if (mounted.current && frame) setFrames((known) => new Map(known).set(key, frame));
        },
        () => asked.current.delete(key),
      );
    }
  }, [data, wanted]);

  return (shot) => frames.get(shotKey(shot));
}
