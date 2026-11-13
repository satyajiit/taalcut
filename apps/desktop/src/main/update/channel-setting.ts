// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which feed a public build reads (P3-B9). Public builds are baked `stable` or `beta`; the person may switch
 * between the two (core UPDATE_CHANNEL_SETTING, changed only by `updates.setChannel`). Team builds (`internal`,
 * `alpha`) and builds without a channel ignore the setting and keep the Phase 1 and 2 feed layout.
 *
 * Public feed layout (D14, GitHub Releases): each channel's yml lives on a fixed release, so the URL never
 * changes: <base>/channel-stable/latest-mac.yml and <base>/channel-beta/beta-mac.yml. Stable is
 * the update library's default channel (`latest`); beta is the `beta` channel. Switching never downgrades:
 * allowDowngrade stays false, so a beta build waits for a stable newer than itself.
 */
import {
  PUBLIC_UPDATE_CHANNELS,
  UPDATE_CHANNEL_SETTING,
  UPDATE_COMMANDS,
  type AsyncResult,
  type EventBus,
  type PublicUpdateChannel,
  type SettingsStore,
  type UpdateChannel,
} from '@taalcut/core';
export function isPublicChannel(channel: UpdateChannel | undefined | null): channel is PublicUpdateChannel {
  return (
    channel !== undefined &&
    channel !== null &&
    (PUBLIC_UPDATE_CHANNELS as readonly string[]).includes(channel)
  );
}

/**
 * The channel this install takes updates from (P3-B14): a public build's chosen channel, else the baked one
 * ('' for none). Session telemetry reports it, so a stable build switched to beta counts as beta.
 */
export async function channelInForce(
  settings: SettingsStore,
  baked: '' | UpdateChannel,
): Promise<'' | UpdateChannel> {
  if (baked === '' || !isPublicChannel(baked)) return baked;
  const stored = await settings.get(UPDATE_CHANNEL_SETTING);
  return stored.ok && stored.value ? stored.value : baked;
}

/** <base>/channel-<channel>/ (the fixed release that holds the channel's yml). */
export function feedUrlFor(base: string, channel: PublicUpdateChannel): string {
  return `${base.replace(/\/+$/, '')}/channel-${channel}/`;
}

export interface EffectiveFeed {
  /** What the generic provider fetches from. */
  readonly feedUrl: string;
  /** The update library's channel: undefined reads latest-mac.yml. */
  readonly updaterChannel: string | undefined;
  /** UpdateState.channel: the channel in force; null without one. */
  readonly channel: UpdateChannel | null;
  /** UpdateState.choice: the public channel in force; null on team builds and builds without a channel. */
  readonly choice: PublicUpdateChannel | null;
}

export interface EffectiveFeedInputs {
  /** The feed the build was baked with (or a test build's --taalcut-update-feed). */
  readonly feed: string;
  /** The baked channel (or a test build's --taalcut-update-channel); undefined for the Phase 1 feed. */
  readonly baked: UpdateChannel | undefined;
  /** UPDATE_CHANNEL_SETTING: the person's choice, null for the build's own. */
  readonly setting: PublicUpdateChannel | null;
}

export function effectiveFeed({ feed, baked, setting }: EffectiveFeedInputs): EffectiveFeed {
  if (!isPublicChannel(baked)) {
    return { feedUrl: feed, updaterChannel: baked, channel: baked ?? null, choice: null };
  }
  const channel = setting ?? baked;
  return {
    feedUrl: feedUrlFor(feed, channel),
    updaterChannel: channel === 'stable' ? undefined : channel,
    channel,
    choice: channel,
  };
}

export interface ChannelSetting {
  read(): AsyncResult<PublicUpdateChannel | null>;
  /** Calls `apply` with the stored choice after every updates.setChannel (and its undo and redo). */
  watch(apply: (choice: PublicUpdateChannel | null) => void): () => void;
}

export function channelSetting(deps: {
  readonly settings: SettingsStore;
  readonly events: EventBus;
  readonly log?: (message: string) => void;
}): ChannelSetting {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const read = () => deps.settings.get(UPDATE_CHANNEL_SETTING);
  return {
    read,
    watch(apply) {
      return deps.events.on('command.changed', (event) => {
        const name = event.payload.name;
        if (name !== UPDATE_COMMANDS.setChannel) return;
        void read().then((stored) =>
          stored.ok ? apply(stored.value) : log(`[update] channel: ${stored.error.code}`),
        );
      });
    },
  };
}
