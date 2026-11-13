// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createEventBus, newId, PRIVACY_COMMANDS, systemClock } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { watchPluginPrivacy } from '../src/main/plugins/plugin-privacy';

describe('plugin privacy changes', () => {
  it('closes active streams as soon as a local-only command arrives, and releases its subscription', () => {
    const events = createEventBus({ clock: systemClock });
    const suspendNetwork = vi.fn(async () => undefined);
    const stop = watchPluginPrivacy(events, { suspendNetwork });
    const emit = (name: string) =>
      events.emit('command.changed', {
        name,
        kind: 'executed',
        id: newId<'Command'>(),
        projectId: null,
        source: 'ui',
        actor: 'user',
      });
    emit('plugins.requestSetup');
    expect(suspendNetwork).not.toHaveBeenCalled();
    emit(PRIVACY_COMMANDS.setLocalOnly);
    expect(suspendNetwork).toHaveBeenCalledOnce();
    stop();
    emit(PRIVACY_COMMANDS.setLocalOnly);
    expect(suspendNetwork).toHaveBeenCalledOnce();
  });
});
