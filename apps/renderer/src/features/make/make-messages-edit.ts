// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the names of the editor's full set of edits (core EDITOR_COMMANDS and AUDIO_EDIT_COMMANDS), which Undo
 * and Redo say in ⌘K and the toasts, as make-messages.ts does for the first edits. Explicit ids: the backend names
 * them.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const MAKE_MESSAGES_EDIT: readonly MessageDescriptor[] = [
  msg({ id: 'commands.timeline.splitClip', message: 'Split a clip in two' }),
  msg({ id: 'commands.timeline.deleteClip', message: 'Delete a clip' }),
  msg({ id: 'commands.timeline.insertClip', message: 'Add a clip' }),
  msg({ id: 'commands.timeline.duplicateClip', message: 'Duplicate a clip' }),
  msg({ id: 'commands.timeline.setSpeed', message: 'Change a clip’s speed' }),
  msg({ id: 'commands.timeline.setTransition', message: 'Add a transition' }),
  msg({ id: 'commands.timeline.removeTransition', message: 'Take out a transition' }),
  msg({ id: 'commands.timeline.setGrade', message: 'Change the colour' }),
  msg({ id: 'commands.timeline.addMarker', message: 'Add a marker' }),
  msg({ id: 'commands.timeline.slipClip', message: 'Use another part of a clip’s shot' }),
  msg({ id: 'commands.audio.setVolume', message: 'Change the volume' }),
  msg({ id: 'commands.audio.trim', message: 'Trim the sound' }),
  msg({ id: 'commands.audio.move', message: 'Move the sound' }),
];
