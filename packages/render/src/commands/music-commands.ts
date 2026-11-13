// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `music.openReferenceAudioWarning`: the fix that render.acknowledgement_required
 * and QA's rightsReferenceAudio check carried before REF1. Nothing raises it
 * now (the reel's music needs no acknowledgement); it stays registered so a
 * fix button on a stored report still dispatches. Read-only: it asks the
 * window for the action (a `ui.action`).
 */
import { defineCommand, MUSIC_COMMANDS, musicCommandPayloads, ok, type EventBus } from '@taalcut/core';

export function createMusicCommands(deps: { readonly events: Pick<EventBus, 'emit'> }) {
  const openReferenceAudioWarning = defineCommand({
    name: MUSIC_COMMANDS.openReferenceAudioWarning,
    payload: musicCommandPayloads[MUSIC_COMMANDS.openReferenceAudioWarning],
    sideEffect: 'read',
    handle: ({ projectId, termsVersion }) => {
      deps.events.emit('ui.action', {
        action: MUSIC_COMMANDS.openReferenceAudioWarning,
        args: { projectId, termsVersion },
      });
      return ok({ result: null });
    },
  });
  return { openReferenceAudioWarning, all: [openReferenceAudioWarning] };
}
