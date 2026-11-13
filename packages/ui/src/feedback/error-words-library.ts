// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/**
 * The words for the errors the library, templates, the timeline, exports and phone transfers can end with
 * (@taalcut/library, @taalcut/templates, @taalcut/timeline, @taalcut/render and @taalcut/transfer): what happened,
 * then what to do. FIX-ERRWORDS: these showed "Something went wrong" (apps/desktop's error-words test checks every
 * code has words). A `name` shown here is a drive's or a clip's name, never a path; `path` is never shown.
 */
export const LIBRARY_ERROR_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  // @taalcut/library: the database, files and search.
  'errors.library.database_open_failed': msg({
    id: 'errors.library.database_open_failed',
    message: 'Taalcut couldn’t open your library. Restart Taalcut, then try again.',
  }),
  'errors.library.database_corrupt': msg({
    id: 'errors.library.database_corrupt',
    message:
      'Your library file is damaged, and none of its backups could replace it. Restart Taalcut, and send feedback if it keeps happening.',
  }),
  'errors.library.schema_too_new': msg({
    id: 'errors.library.schema_too_new',
    message: 'Your library was saved by a newer version of Taalcut. Update Taalcut to open it.',
  }),
  'errors.library.migration_mismatch': msg({
    id: 'errors.library.migration_mismatch',
    message:
      'Your library doesn’t match what this version of Taalcut expects. Update Taalcut, then open it again.',
  }),
  'errors.library.migration_failed': msg({
    id: 'errors.library.migration_failed',
    message: 'Taalcut couldn’t update your library for this version. Restart Taalcut to try again.',
  }),
  'errors.library.backup_failed': msg({
    id: 'errors.library.backup_failed',
    message: 'Taalcut couldn’t back up your library this time. It tries again later.',
  }),
  'errors.library.conflict': msg({
    id: 'errors.library.conflict',
    message: 'Something with that name is already there. Pick another name.',
  }),
  'errors.library.constraint_violation': msg({
    id: 'errors.library.constraint_violation',
    message: 'That change didn’t fit with the rest of your library, so it wasn’t saved. Try again.',
  }),
  'errors.library.invalid_state': msg({
    id: 'errors.library.invalid_state',
    message: 'That’s already been done, so there was nothing to change.',
  }),
  'errors.library.database_busy': msg({
    id: 'errors.library.database_busy',
    message: 'Your library is busy. Try again in a moment.',
  }),
  'errors.library.disk_full': msg({
    id: 'errors.library.disk_full',
    message: 'The disk is full. Free up space and try again.',
  }),
  'errors.library.query_failed': msg({
    id: 'errors.library.query_failed',
    message: 'Taalcut couldn’t read your library. Try again.',
  }),
  'errors.library.unit_of_work_full': msg({
    id: 'errors.library.unit_of_work_full',
    message: 'Too many changes are waiting to be saved. Wait a moment, then try again.',
  }),
  'errors.library.artifact_too_large': msg({
    id: 'errors.library.artifact_too_large',
    message: 'That file is too big for Taalcut to keep.',
  }),
  'errors.library.artifacts_unavailable': msg({
    id: 'errors.library.artifacts_unavailable',
    message: 'Taalcut couldn’t save that file. Check the disk has space, then try again.',
  }),
  'errors.library.vector_extension_unavailable': msg({
    id: 'errors.library.vector_extension_unavailable',
    message:
      'Searching clips by meaning can’t run in this copy of Taalcut, so it searched by words. Reinstall Taalcut to get it back.',
  }),
  'errors.library.vector_index_mismatch': msg({
    id: 'errors.library.vector_index_mismatch',
    message: 'Clip search needs rebuilding. Try again once indexing finishes.',
  }),
  'errors.library.embedder_unavailable': msg({
    id: 'errors.library.embedder_unavailable',
    message:
      'Searching clips by meaning isn’t ready yet, so Taalcut searched by words. Try again once its model has downloaded.',
  }),
  'errors.library.originals_offline': msg({
    id: 'errors.library.originals_offline',
    message: 'The drive “{name}” isn’t plugged in. Plug it in, then try again.',
  }),
  'errors.library.original_unavailable': msg({
    id: 'errors.library.original_unavailable',
    message:
      'The original of “{name}” can’t be reached: its drive may be unplugged. Plug it in, and Taalcut tries again.',
  }),
  'errors.library.relink_mismatch': msg({
    id: 'errors.library.relink_mismatch',
    message: '“{name}” isn’t the same file Taalcut checked before. Choose the original file.',
  }),
  'errors.library.places_unavailable': msg({
    id: 'errors.library.places_unavailable',
    message:
      'Taalcut couldn’t name where this clip was filmed: its list of places is missing. The clip itself is fine.',
  }),

  // @taalcut/templates
  'errors.templates.unsupported_link': msg({
    id: 'errors.templates.unsupported_link',
    message: 'That link isn’t a Reel, a Short or a TikTok. Paste a link to one of those.',
  }),
  'errors.templates.breakdown_not_found': msg({
    id: 'errors.templates.breakdown_not_found',
    message: 'That breakdown isn’t here any more. Send the reel again.',
  }),
  'errors.templates.experiment_gone': msg({
    id: 'errors.templates.experiment_gone',
    message: 'That breakdown’s working files were cleared. Send the reel again.',
  }),
  'errors.templates.unsupported_schema': msg({
    id: 'errors.templates.unsupported_schema',
    message: 'This template was made by a newer version of Taalcut. Update Taalcut to open it.',
  }),
  'errors.templates.slot_not_found': msg({
    id: 'errors.templates.slot_not_found',
    message: 'That slot isn’t in the template any more.',
  }),
  'errors.templates.slots_not_adjacent': msg({
    id: 'errors.templates.slots_not_adjacent',
    message: 'Only slots next to each other can be joined.',
  }),
  'errors.templates.last_slot': msg({
    id: 'errors.templates.last_slot',
    message: 'A template needs at least one slot, so this one stays.',
  }),
  'errors.templates.slot_approved': msg({
    id: 'errors.templates.slot_approved',
    message: 'You approved this slot, so Taalcut won’t change it. Change it yourself if you want to.',
  }),
  // BRK1: the review's edits and Tell Taalcut.
  'errors.templates.first_slot_cut': msg({
    id: 'errors.templates.first_slot_cut',
    message: 'The first slot starts the reel, so its start can’t move.',
  }),
  'errors.templates.cut_out_of_range': msg({
    id: 'errors.templates.cut_out_of_range',
    message: 'A cut can’t go there. Keep it between the cuts on either side, at least one frame from each.',
  }),
  'errors.templates.overlay_not_found': msg({
    id: 'errors.templates.overlay_not_found',
    message: 'That text isn’t in the template any more.',
  }),
  'errors.templates.doubt_not_found': msg({
    id: 'errors.templates.doubt_not_found',
    message: 'That was already checked.',
  }),
  'errors.templates.proposals_unreadable': msg({
    id: 'errors.templates.proposals_unreadable',
    message: 'Taalcut couldn’t read the model’s suggestions. Try again.',
  }),
  'errors.templates.budget_reached': msg({
    id: 'errors.templates.budget_reached',
    message:
      'This project has spent its budget, so Taalcut didn’t ask the model. Raise the project’s budget, or make the change yourself.',
  }),
  'errors.templates.in_use': msg({
    id: 'errors.templates.in_use',
    message:
      '{timelines, plural, one {# video uses} other {# videos use}} this template, so it can’t be deleted. Delete or change {timelines, plural, one {that video} other {those videos}} first.',
  }),
  'errors.templates.format_target': msg({
    id: 'errors.templates.format_target',
    message: 'That length doesn’t work for this format. Pick between {min} and {max} seconds.',
  }),
  'errors.templates.starter_not_found': msg({
    id: 'errors.templates.starter_not_found',
    message: 'That starter template isn’t available any more. Pick another.',
  }),

  // @taalcut/timeline
  'errors.timeline.no_captions': msg({
    id: 'errors.timeline.no_captions',
    message: 'This video has no captions yet. Add captions first.',
  }),
  'errors.timeline.variants_none': msg({
    id: 'errors.timeline.variants_none',
    message: 'Taalcut couldn’t make any versions of this video. Try other changes.',
  }),
  'errors.timeline.gap_not_found': msg({
    id: 'errors.timeline.gap_not_found',
    message: 'That gap isn’t in the video any more.',
  }),
  'errors.timeline.not_a_gap': msg({
    id: 'errors.timeline.not_a_gap',
    message: 'That spot already has a clip, so there’s no gap to fill.',
  }),

  // @taalcut/render: exports, graphics, looks and translated captions.
  'errors.render.batch_too_large': msg({
    id: 'errors.render.batch_too_large',
    message: 'An export batch holds up to {max} videos. Export the rest in another batch.',
  }),
  'errors.render.cube_invalid': msg({
    id: 'errors.render.cube_invalid',
    message: 'Taalcut can’t read that look file. Use a .cube file from your editing app.',
  }),
  'errors.render.grade_failed': msg({
    id: 'errors.render.grade_failed',
    message: 'Couldn’t apply the colour look. Try again.',
  }),
  // The media cards' words, word for word (media-errors.ts kept them until FIX-ERRWORDS), so chat says them too.
  'errors.render.graphic_invalid': msg({
    id: 'errors.render.graphic_invalid',
    message: 'That graphic can’t change that way. Ask for a new design of it instead.',
  }),
  'errors.render.translation_mismatch': msg({
    id: 'errors.render.translation_mismatch',
    message: 'The translated captions don’t match the originals line for line. Translate them again.',
  }),

  // @taalcut/transfer: clips from a phone, over Wi-Fi or a cable.
  'errors.transfer.no_network': msg({
    id: 'errors.transfer.no_network',
    message: 'Taalcut needs Wi-Fi to reach your phone. Join a Wi-Fi network, then try again.',
  }),
  'errors.transfer.bind_failed': msg({
    id: 'errors.transfer.bind_failed',
    message: 'Taalcut couldn’t open a connection for your phone. Try again.',
  }),
  'errors.transfer.session_closed': msg({
    id: 'errors.transfer.session_closed',
    message: 'This transfer has ended. Show a new code to send more.',
  }),
  'errors.transfer.pairing_failed': msg({
    id: 'errors.transfer.pairing_failed',
    message: 'Your phone couldn’t connect. Show a new code and scan it again.',
  }),
  'errors.transfer.not_media': msg({
    id: 'errors.transfer.not_media',
    message: 'That file isn’t a photo or a video, so it wasn’t added.',
  }),
  'errors.transfer.too_large': msg({
    id: 'errors.transfer.too_large',
    message: 'That file is too big to send this way. Bring it in over a cable, or add it from a folder.',
  }),
  'errors.transfer.disk_full': msg({
    id: 'errors.transfer.disk_full',
    message: 'The disk is full, so the clips couldn’t be saved. Free up space and try again.',
  }),
  'errors.transfer.import_failed': msg({
    id: 'errors.transfer.import_failed',
    message: 'Couldn’t add the clips to your library. Try again.',
  }),
  'errors.transfer.device_gone': msg({
    id: 'errors.transfer.device_gone',
    message: 'Your phone was unplugged. Plug it back in and try again.',
  }),
  'errors.transfer.device_locked': msg({
    id: 'errors.transfer.device_locked',
    message: 'Your phone is locked. Unlock it, allow access if it asks, then try again.',
  }),
  'errors.transfer.device_busy': msg({
    id: 'errors.transfer.device_busy',
    message: 'Another app is using your phone’s connection. Quit that app, then try again.',
  }),
  'errors.transfer.device_unsupported': msg({
    id: 'errors.transfer.device_unsupported',
    message: 'Taalcut can’t bring clips from this phone over a cable. Send them over Wi-Fi instead.',
  }),
  'errors.transfer.too_many_items': msg({
    id: 'errors.transfer.too_many_items',
    message: 'That’s more clips than one transfer takes. Pick fewer, then send the rest after.',
  }),
  'errors.transfer.run_in_progress': msg({
    id: 'errors.transfer.run_in_progress',
    message: 'Clips are already coming from this phone. Wait for them to finish.',
  }),
  'errors.transfer.short_read': msg({
    id: 'errors.transfer.short_read',
    message: 'A clip didn’t arrive in full. Try again.',
  }),
  'errors.transfer.hash_mismatch': msg({
    id: 'errors.transfer.hash_mismatch',
    message: 'A clip changed on the way from your phone. Try again.',
  }),
  'errors.transfer.bridge_failed': msg({
    id: 'errors.transfer.bridge_failed',
    message: 'The cable connection to your phone stopped. Unplug it, plug it back in, then try again.',
  }),
};
