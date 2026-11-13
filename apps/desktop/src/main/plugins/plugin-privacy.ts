// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { PRIVACY_COMMANDS, type EventBus, type PluginService } from '@taalcut/core';

/** Stop existing streams on privacy changes, including SDK reconnects. New calls recheck persisted policy. */
export function watchPluginPrivacy(
  events: EventBus,
  plugins: Pick<PluginService, 'suspendNetwork'>,
): () => void {
  return events.on('command.changed', (event) => {
    if (event.payload.name === PRIVACY_COMMANDS.setLocalOnly) {
      void plugins.suspendNetwork().catch(() => {
        console.warn('[plugins] a transport could not finish closing');
      });
    }
  });
}
