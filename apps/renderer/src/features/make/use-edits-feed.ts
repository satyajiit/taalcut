// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, PLUGIN_COMMANDS, type TaalcutError } from '@taalcut/core';
import { useState } from 'react';
import { useCommand } from '../../backend/use-command';
import { useRpcQuery } from '../../backend/use-rpc';
import { usePlugins } from '../settings/plugins/use-plugins';
import {
  parseEditsTracks,
  type EditsAudioTrack,
  type EditsLicenseFilter,
  type EditsMusicTab,
} from './edits-pulse-model';

/** Only the connected backend supplies tracks; failed or empty reads never become demo audio. */
export function useEditsFeed(tab: EditsMusicTab, query: string, license: EditsLicenseFilter) {
  const plugins = usePlugins();
  const { run } = useCommand({ toast: false });
  const plugin = plugins.data?.find((item) => item.manifest.id === 'instagram-edits');
  const isLiveConnected = plugin?.status === 'active';
  const canRead =
    !!plugin && ['music-read', 'projects-write'].every((id) => plugin.grantedAccess.includes(id));
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<TaalcutError | null>(null);
  const feed = useRpcQuery(async () => {
    if (!isLiveConnected || !canRead) return ok<readonly EditsAudioTrack[]>([]);
    const result = await run({
      name: PLUGIN_COMMANDS.call,
      payload: {
        pluginId: 'instagram-edits',
        mode: 'external',
        toolName: tab === 'Saved' ? 'api.getSavedTracks' : 'api.listMusicTracks',
        input:
          tab === 'Saved'
            ? {}
            : {
                tab,
                ...(query.trim() ? { query: query.trim() } : {}),
                ...(license !== 'any' ? { license } : {}),
              },
      },
    });
    return result.ok ? ok(parseEditsTracks(result.value, new Set())) : result;
  }, [run, isLiveConnected, canRead, tab, query, license]);
  const response = feed.stale ? undefined : feed.data;
  const q = query.trim().toLocaleLowerCase();
  const tracks =
    isLiveConnected && canRead && response?.ok
      ? response.value
          .filter(
            (track) =>
              (license !== 'royaltyFree' || track.isRoyaltyFree) &&
              (license !== 'licensed' || track.isLicensedMusic) &&
              (!q || `${track.title} ${track.artistName}`.toLocaleLowerCase().includes(q)),
          )
          .map((track) => ({ ...track, isSaved: tab === 'Saved' || track.isSaved || savedIds.has(track.id) }))
      : [];
  const error =
    saveError ??
    (feed.status === 'error' ? feed.error : response && !response.ok ? response.error : null) ??
    plugins.error;

  async function saveTrack(track: EditsAudioTrack) {
    if (!isLiveConnected || !canRead || track.isSaved || saving) return;
    setSaving(track.id);
    setSaveError(null);
    const result = await run({
      name: PLUGIN_COMMANDS.call,
      payload: {
        pluginId: 'instagram-edits',
        mode: 'external',
        toolName: 'api.favoriteMusicTrack',
        input: { track: track.audioAssetId },
      },
    });
    if (result.ok) setSavedIds((previous) => new Set([...previous, track.id]));
    else setSaveError(result.error);
    setSaving(null);
  }
  return {
    tracks,
    isLiveConnected,
    canRead,
    fetching: isLiveConnected && feed.status === 'loading',
    saving,
    saveTrack,
    error,
    reload: feed.reload,
    disabled: plugin?.enabled === false,
  };
}
