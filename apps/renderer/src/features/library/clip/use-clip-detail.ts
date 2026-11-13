// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type AssetDetail, type AssetId } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { pendingClip } from './clip-prefetch';

/**
 * The media cache let a file the clip page shows go (UX2, round 2): its stage finished but the detail has no file,
 * the copy to play or the filmstrip. The library makes it again when the clip is opened (`indexing.prioritise`).
 */
export function letGo(detail: Pick<AssetDetail, 'filmstrip' | 'playback' | 'stages'>): boolean {
  const done = (stage: string) => detail.stages.some((row) => row.stage === stage && row.state === 'done');
  return (
    (detail.filmstrip === null && done('media.filmstrip')) ||
    (detail.playback === null && done('media.proxy'))
  );
}

/**
 * One clip in full (`library.asset`), read again whenever the library says the clip or one of its shots changed
 * (a stage finished, it was re-indexed, its file came back). While Taalcut is still looking at it, or a file it shows
 * was let go, someone looking at its page moves it to the front of the queue (the library makes those files again).
 * Nothing here keeps its files in the media cache: main does, for as long as a window shows this page, however long
 * that is (UX2 round 4, apps/desktop main/open-clips.ts), so its copy never goes mid-view.
 */
export function useClipDetail(assetId: AssetId) {
  const backend = useBackend();
  const [round, setRound] = useState(0);
  // The first read takes the one a pointer at its tile started, if it is on its way or here (clip-prefetch.ts).
  const first = useRef(true);
  const detail = useRpcQuery(
    (signal) => {
      const ahead = first.current ? pendingClip(assetId) : undefined;
      first.current = false;
      const read = () => backend.library.asset({ assetId }, { signal });
      return ahead ? ahead.then((answer) => (answer.ok ? answer.value : read())) : read();
    },
    [backend, assetId, round],
  );
  useBackendEvents(['library.changed'], ({ payload }) => {
    if ((payload.entity === 'asset' || payload.entity === 'shot') && payload.ids.includes(assetId))
      setRound((n) => n + 1);
  });
  const data = detail.data;
  const state = data?.asset.index.state;
  const pending = state !== undefined && state !== 'done' && state !== 'failed';
  const wanted = pending || (data !== undefined && letGo(data));
  useEffect(() => {
    if (wanted) void callRpc(backend.indexing.prioritise({ assetIds: [assetId] }));
  }, [backend, assetId, wanted]);

  return { ...detail, refresh: () => setRound((n) => n + 1) };
}
