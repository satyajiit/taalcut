// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which update feed a run checks (P1-B4). Pure, so the rules are unit-tested.
 *
 * - Unpackaged runs never update (the update library can't replace a dev run).
 * - Packaged builds check the feed baked in at build time (https, validated by
 *   packaging/build-settings.ts), or nothing if none was baked in.
 * - Test builds may override it with --taalcut-update-feed, which also allows
 *   loopback http for the local test feed.
 * - The channel is baked (`__TAALCUT_UPDATE_CHANNEL__`). A test build may
 *   override it with --taalcut-update-channel. Release builds cannot.
 *   Empty channel is latest-mac.yml; otherwise `<channel>-mac.yml`.
 */

import { UPDATE_CHANNELS, type UpdateChannel } from '@taalcut/core';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const CHANNELS = new Set<string>(UPDATE_CHANNELS);

/** --taalcut-update-channel, test builds only. Release builds ignore it. */
export const UPDATE_CHANNEL_SWITCH = 'taalcut-update-channel';

export interface UpdateFeedInputs {
  readonly packaged: boolean;
  readonly flavour: 'release' | 'test';
  /** __TAALCUT_UPDATE_FEED__, '' for none. */
  readonly bakedFeed: string;
  /** Value of --taalcut-update-feed (test builds only). */
  readonly testFeed?: string | undefined;
}

export interface UpdateChannelInputs {
  readonly flavour: 'release' | 'test';
  /** __TAALCUT_UPDATE_CHANNEL__, '' for the Phase 1 latest-mac.yml feed. */
  readonly bakedChannel: '' | UpdateChannel;
  /** Value of --taalcut-update-channel (test builds only). */
  readonly testChannel?: string | undefined;
}

/**
 * Which channel file the update library's generic provider requests.
 * Empty stays Phase 1 (`latest-mac.yml`); `alpha` is `alpha-mac.yml`.
 */
export function updateFeedFileName(channel?: string): string {
  if (!channel) return 'latest-mac.yml';
  if (!CHANNELS.has(channel)) throw new Error(`Bad update channel: ${channel}`);
  return `${channel}-mac.yml`;
}

/**
 * Release builds use only the baked channel. A test build may override it
 * with --taalcut-update-channel. Empty means no channel (latest-mac.yml).
 */
export function resolveUpdateChannel(inputs: UpdateChannelInputs): UpdateChannel | undefined {
  if (inputs.flavour === 'test') {
    const override = inputs.testChannel?.trim();
    if (override) {
      if (!CHANNELS.has(override)) throw new Error(`Bad --${UPDATE_CHANNEL_SWITCH}: ${override}`);
      return override as UpdateChannel;
    }
  }
  return inputs.bakedChannel || undefined;
}

export function resolveUpdateFeed(inputs: UpdateFeedInputs): string | undefined {
  if (!inputs.packaged) return undefined;
  if (inputs.flavour === 'test' && inputs.testFeed) {
    if (!isAllowedTestFeed(inputs.testFeed)) throw new Error(`Bad --taalcut-update-feed: ${inputs.testFeed}`);
    return inputs.testFeed;
  }
  return inputs.bakedFeed || undefined;
}

function isAllowedTestFeed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
}
