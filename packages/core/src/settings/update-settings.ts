// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Update settings (P3-B9, P3-B14): the person's channel on a public build, and the versions this Mac rolled back
 * from. `updates.setChannel` is person-only; choosing beta needs BETA_TERMS acknowledged first
 * (desktop.beta_terms_required). Handler: apps/desktop's agent root.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { PUBLIC_UPDATE_CHANNELS } from '../ipc/main-services-contracts';
import { defineSetting } from '../ports/preferences';

/** null: the build's baked channel. */
export const UPDATE_CHANNEL_SETTING = defineSetting(
  'updates.channel',
  z.enum(PUBLIC_UPDATE_CHANNELS).nullable(),
  null,
);
/** Versions this Mac rolled back from: never downloaded again. Written by main directly (no command). */
export const UPDATE_BLOCKED_SETTING = defineSetting(
  'updates.blocked',
  z.array(z.string().min(1).max(64)).max(32),
  [],
);

export const UPDATE_COMMANDS = {
  /** write, app-wide; inverse `setChannel` with the previous value (null included); person sources only. */
  setChannel: 'updates.setChannel',
} as const;

export const updateCommandPayloads = {
  [UPDATE_COMMANDS.setChannel]: z.object({
    projectId: z.null().default(null),
    /**
     * null (round P3-3): back to the build's own channel, what UPDATE_CHANNEL_SETTING holds until the first
     * choice. Undo of that first choice sends it; Settings offers stable and beta only.
     */
    channel: z.enum(PUBLIC_UPDATE_CHANNELS).nullable(),
  }),
};
