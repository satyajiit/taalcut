// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the keys @taalcut/timeline and the projects store send:
 * their error codes (errors.<code>), their commands' names (commands.<name>,
 * which Undo and Redo say in ⌘K and the toasts), the markers the editor
 * shows and the fix that opens the reference-audio warning. Those packages
 * carry keys, never English, so the renderer owns the words, as it does for
 * render's (features/renders/render-messages.ts). Explicit ids: the backend
 * names them.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

export const MAKE_MESSAGES: readonly MessageDescriptor[] = [
  // Errors.
  msg({ id: 'errors.timeline.not_found', message: 'This video isn’t here any more.' }),
  msg({ id: 'errors.timeline.item_not_found', message: 'That clip isn’t on the timeline any more.' }),
  msg({
    id: 'errors.timeline.clip_locked',
    message: 'You locked this clip, so Taalcut left it alone. Unlock it to let Taalcut change it.',
  }),
  msg({
    id: 'errors.timeline.media_too_short',
    message: 'That shot is too short for this spot. Pick a longer one, or make the spot shorter first.',
  }),
  msg({
    id: 'errors.timeline.media_missing',
    message: 'The clip’s original isn’t on this Mac. Reconnect the drive or folder it was on.',
  }),
  msg({
    id: 'errors.timeline.invalid_move',
    message: 'That edit would break the cut. Try a smaller change.',
  }),
  msg({
    id: 'errors.timeline.unsupported_schema',
    message: 'This video was made by a newer Taalcut. Update Taalcut to open it.',
  }),
  msg({
    id: 'errors.timeline.no_candidates',
    message: 'Nothing in your library fits these slots yet. Add footage, then try again.',
  }),
  msg({ id: 'errors.timeline.template_not_found', message: 'The template this video follows is gone.' }),
  msg({ id: 'fix.openReferenceAudioWarning', message: 'Read and decide' }),

  // Commands (commands.<name>).
  msg({ id: 'commands.timeline.create', message: 'Make the cut' }),
  msg({ id: 'commands.timeline.swapClip', message: 'Swap a clip' }),
  msg({ id: 'commands.timeline.trimClip', message: 'Trim a clip' }),
  msg({ id: 'commands.timeline.moveClip', message: 'Move a clip' }),
  msg({ id: 'commands.timeline.editText', message: 'Edit text' }),
  msg({ id: 'commands.timeline.moveText', message: 'Move text' }),
  msg({ id: 'commands.timeline.lockClip', message: 'Lock a clip' }),
  msg({ id: 'commands.timeline.applyCast', message: 'Recast the clips' }),
  msg({ id: 'commands.timeline.restore', message: 'Put the timeline back' }),
  msg({ id: 'commands.timeline.discard', message: 'Delete a video' }),
  msg({ id: 'commands.music.choosePath', message: 'Choose the music' }),
  msg({ id: 'commands.project.create', message: 'New project' }),
  msg({ id: 'commands.project.rename', message: 'Rename a project' }),
  msg({ id: 'commands.project.archive', message: 'Archive a project' }),
  msg({ id: 'commands.project.unarchive', message: 'Bring a project back' }),
  msg({ id: 'commands.project.saveVersion', message: 'Save a version' }),
  msg({ id: 'commands.project.renameVersion', message: 'Rename a version' }),
  msg({ id: 'commands.project.deleteVersion', message: 'Delete a version' }),
  msg({ id: 'commands.project.restoreVersion', message: 'Restore a version' }),

  // Markers the timeline package writes (MARKER_LABELS).
  msg({ id: 'timeline.marker.offBeat', message: 'Off the beat' }),
  msg({ id: 'timeline.marker.noSyncPoint', message: 'No moment to put on the beat' }),
  msg({ id: 'timeline.marker.noHandle', message: 'No room for the transition' }),
  msg({ id: 'timeline.marker.hook', message: 'The hook' }),
];
