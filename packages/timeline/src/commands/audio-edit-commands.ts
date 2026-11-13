// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: core's AUDIO_EDIT_COMMANDS (the sound's level, mute and fades; a voice line's, an effect's or the
 * music's trim and move). They change the timeline document only, so this package handles them like its own edits:
 * one undo step each, its inverse `timeline.restore` with the tracks, music choice or mix as they were.
 */
import { AUDIO_EDIT_COMMANDS, defineCommand, editorCommandPayloads as payloads } from '@taalcut/core';
import { moveSound, trimSound } from '../edits/audio-place';
import { setVolume } from '../edits/audio-volume';
import type { CommandDeps } from './context';
import { writeMade } from './editor-commands';

export function createAudioEditCommands(deps: CommandDeps) {
  const volume = defineCommand({
    name: AUDIO_EDIT_COMMANDS.setVolume,
    payload: payloads[AUDIO_EDIT_COMMANDS.setVolume],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => setVolume(timeline, payload, options)),
  });

  const trim = defineCommand({
    name: AUDIO_EDIT_COMMANDS.trim,
    payload: payloads[AUDIO_EDIT_COMMANDS.trim],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => trimSound(timeline, payload, options)),
  });

  const move = defineCommand({
    name: AUDIO_EDIT_COMMANDS.move,
    payload: payloads[AUDIO_EDIT_COMMANDS.move],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => moveSound(timeline, payload, options)),
  });

  return { volume, trim, move, all: [volume, trim, move] };
}
